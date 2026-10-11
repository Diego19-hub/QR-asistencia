-- Stage 3: schedule versions, planned breaks and atomic employee assignments.
-- The original schedule and attendance tables remain intact; new columns are additive.

alter table public.schedule_templates
  add column workday_type text not null default 'day'
    check (workday_type in ('day', 'night', 'mixed')),
  add column entry_tolerance_minutes smallint not null default 0
    check (entry_tolerance_minutes between 0 and 1440),
  add column effective_from date not null default current_date,
  add column effective_to date,
  add column revision_of uuid;

alter table public.schedule_templates
  add constraint schedule_templates_revision_fk
  foreign key (company_id, revision_of)
  references public.schedule_templates(company_id, id) on delete restrict;

alter table public.schedule_templates
  add constraint schedule_templates_effective_dates_check
  check (effective_to is null or effective_to >= effective_from);

alter table public.break_rules
  add column requires_qr boolean not null default false;

create table public.schedule_template_breaks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  template_day_id uuid not null,
  break_rule_id uuid not null,
  planned_start_local time not null,
  planned_end_local time not null,
  planned_minutes integer not null check (planned_minutes between 1 and 1440),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (template_day_id, break_rule_id),
  foreign key (company_id, template_day_id)
    references public.schedule_template_days(company_id, id) on delete cascade,
  foreign key (company_id, break_rule_id)
    references public.break_rules(company_id, id) on delete restrict
);

create index schedule_template_breaks_company_day_idx
  on public.schedule_template_breaks(company_id, template_day_id);

alter table public.schedule_template_breaks enable row level security;
revoke all on public.schedule_template_breaks from anon;
grant select, insert, update, delete on public.schedule_template_breaks to authenticated;
create policy schedule_template_breaks_read on public.schedule_template_breaks
  for select to authenticated
  using (private.has_company_permission(company_id, 'company.read'));
create policy schedule_template_breaks_manage on public.schedule_template_breaks
  for all to authenticated
  using (private.has_company_permission(company_id, 'schedules.manage'))
  with check (private.has_company_permission(company_id, 'schedules.manage'));

-- Assignments use inclusive start/end dates. Serialize assignment changes by employee
-- and reject overlapping periods even when requests race.
create or replace function private.guard_schedule_assignment_overlap()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform 1 from public.employees e
    where e.company_id = new.company_id and e.id = new.employee_id
    for update;

  if exists (
    select 1 from public.schedule_assignments a
    where a.company_id = new.company_id
      and a.employee_id = new.employee_id
      and a.id is distinct from new.id
      and a.starts_on <= coalesce(new.ends_on, 'infinity'::date)
      and new.starts_on <= coalesce(a.ends_on, 'infinity'::date)
  ) then
    raise exception 'schedule assignment overlaps an existing period'
      using errcode = '23P01';
  end if;
  return new;
end
$$;

create trigger schedule_assignments_no_overlap
  before insert or update of employee_id, starts_on, ends_on, company_id
  on public.schedule_assignments
  for each row execute function private.guard_schedule_assignment_overlap();

-- Structural edits to a template already used for attendance must be made as a new
-- revision. Active status remains editable so old templates can be retired safely.
create or replace function private.guard_assigned_template_immutability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.schedule_assignments a
      where a.company_id = old.company_id and a.template_id = old.id)
      and (new.company_id, new.branch_id, new.name, new.kind, new.workday_type,
          new.entry_tolerance_minutes, new.effective_from, new.effective_to, new.revision_of)
         is distinct from
         (old.company_id, old.branch_id, old.name, old.kind, old.workday_type,
          old.entry_tolerance_minutes, old.effective_from, old.effective_to, old.revision_of) then
    raise exception 'assigned schedules are immutable; create a new revision'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger schedule_templates_immutable_after_assignment
  before update on public.schedule_templates
  for each row execute function private.guard_assigned_template_immutability();

create or replace function private.guard_assigned_template_day_immutability()
returns trigger language plpgsql set search_path = '' as $$
declare template_company uuid; template uuid;
begin
  template_company := coalesce(new.company_id, old.company_id);
  template := coalesce(new.template_id, old.template_id);
  if exists (select 1 from public.schedule_assignments a
      where a.company_id = template_company and a.template_id = template) then
    raise exception 'assigned schedule days are immutable; create a new revision'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end
$$;

create trigger schedule_template_days_immutable_after_assignment
  before update or delete on public.schedule_template_days
  for each row execute function private.guard_assigned_template_day_immutability();

create or replace function private.guard_assigned_template_break_immutability()
returns trigger language plpgsql set search_path = '' as $$
declare template_company uuid; day_id uuid;
begin
  template_company := coalesce(new.company_id, old.company_id);
  day_id := coalesce(new.template_day_id, old.template_day_id);
  if exists (
    select 1 from public.schedule_assignments a
    join public.schedule_template_days d
      on d.company_id = a.company_id and d.template_id = a.template_id
    where a.company_id = template_company and d.id = day_id
  ) then
    raise exception 'assigned schedule breaks are immutable; create a new revision'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end
$$;

create trigger schedule_template_breaks_immutable_after_assignment
  before update or delete on public.schedule_template_breaks
  for each row execute function private.guard_assigned_template_break_immutability();

-- End an earlier assignment and insert the replacement in one transaction. Assignments
-- beginning on or after the requested date are left untouched and cause a conflict.
create or replace function public.assign_employee_schedule(
  p_company_id uuid,
  p_employee_ids uuid[],
  p_template_id uuid,
  p_branch_id uuid,
  p_starts_on date,
  p_ends_on date default null
) returns setof public.schedule_assignments
language plpgsql security invoker set search_path = '' as $$
declare
  employee uuid;
  first_day public.schedule_template_days%rowtype;
  template_row public.schedule_templates%rowtype;
  new_assignment public.schedule_assignments%rowtype;
begin
  if p_starts_on is null or (p_ends_on is not null and p_ends_on < p_starts_on) then
    raise exception 'invalid assignment dates' using errcode = '22023';
  end if;
  if p_employee_ids is null or cardinality(p_employee_ids) = 0 then
    raise exception 'at least one employee is required' using errcode = '22023';
  end if;
  if cardinality(p_employee_ids) <> (select count(distinct x) from unnest(p_employee_ids) x) then
    raise exception 'duplicate employee ids are not allowed' using errcode = '22023';
  end if;

  select * into template_row from public.schedule_templates t
    where t.company_id = p_company_id and t.id = p_template_id
      and t.branch_id = p_branch_id and t.active;
  if not found then raise exception 'active schedule template not found' using errcode = '23503'; end if;
  if p_starts_on < template_row.effective_from or
     (template_row.effective_to is not null and
       (p_starts_on > template_row.effective_to or coalesce(p_ends_on, template_row.effective_to) > template_row.effective_to)) then
    raise exception 'assignment dates must be within the schedule validity period' using errcode = '23514';
  end if;

  select d.* into first_day from public.schedule_template_days d
    where d.company_id = p_company_id and d.template_id = p_template_id
    order by d.iso_weekday limit 1;
  if not found then raise exception 'schedule template has no working days' using errcode = '23514'; end if;

  foreach employee in array p_employee_ids loop
    perform 1 from public.employees e where e.company_id = p_company_id
      and e.id = employee and e.active for update;
    if not found then raise exception 'active employee not found' using errcode = '23503'; end if;

    if exists (select 1 from public.schedule_assignments a
        where a.company_id = p_company_id and a.employee_id = employee
          and a.starts_on >= p_starts_on
          and a.starts_on <= coalesce(p_ends_on, 'infinity'::date)) then
      raise exception 'a future assignment overlaps; change its dates first'
        using errcode = '23P01';
    end if;

    update public.schedule_assignments a set ends_on = p_starts_on - 1
      where a.company_id = p_company_id and a.employee_id = employee
        and a.starts_on < p_starts_on
        and (a.ends_on is null or a.ends_on >= p_starts_on);

    insert into public.schedule_assignments(
      company_id, employee_id, template_id, branch_id, starts_on, ends_on,
      timezone, kind, planned_start_local, planned_end_local, planned_minutes
    ) values (
      p_company_id, employee, p_template_id, p_branch_id, p_starts_on, p_ends_on,
      (select b.timezone from public.branches b where b.company_id = p_company_id and b.id = p_branch_id),
      template_row.kind, first_day.start_local, first_day.end_local, first_day.scheduled_minutes
    ) returning * into new_assignment;
    return next new_assignment;
  end loop;
  return;
end
$$;

revoke all on function public.assign_employee_schedule(uuid, uuid[], uuid, uuid, date, date) from public, anon;
grant execute on function public.assign_employee_schedule(uuid, uuid[], uuid, uuid, date, date) to authenticated;

create or replace function public.save_schedule_template(
  p_company_id uuid,
  p_branch_id uuid,
  p_name text,
  p_kind public.schedule_kind,
  p_workday_type text,
  p_entry_tolerance_minutes smallint,
  p_effective_from date,
  p_effective_to date,
  p_days jsonb,
  p_revision_of uuid default null
) returns public.schedule_templates
language plpgsql security invoker set search_path = '' as $$
declare
  saved public.schedule_templates%rowtype;
  source public.schedule_templates%rowtype;
  day_input record;
  break_input record;
  day_id uuid;
  rule_id uuid;
  rule_code text;
begin
  if length(trim(p_name)) not between 1 and 120 then
    raise exception 'schedule name must contain 1 to 120 characters' using errcode = '22023';
  end if;
  if p_workday_type not in ('day','night','mixed') then
    raise exception 'invalid workday type' using errcode = '22023';
  end if;
  if p_entry_tolerance_minutes not between 0 and 1440 then
    raise exception 'entry tolerance is outside the allowed range' using errcode = '22023';
  end if;
  if p_effective_from is null or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'invalid schedule validity dates' using errcode = '22023';
  end if;
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) not between 1 and 7 then
    raise exception 'schedule must define one to seven working days' using errcode = '22023';
  end if;
  if (select count(distinct (x->>'weekday')::smallint) from jsonb_array_elements(p_days) x)
       <> jsonb_array_length(p_days) then
    raise exception 'schedule weekdays must be unique' using errcode = '22023';
  end if;

  if p_revision_of is not null then
    select * into source from public.schedule_templates t
      where t.company_id = p_company_id and t.id = p_revision_of and t.branch_id = p_branch_id;
    if not found then raise exception 'schedule to revise not found' using errcode = '23503'; end if;
  end if;

  insert into public.schedule_templates(
    company_id, branch_id, name, kind, active, workday_type,
    entry_tolerance_minutes, effective_from, effective_to, revision_of
  ) values (
    p_company_id, p_branch_id, trim(p_name), p_kind, true, p_workday_type,
    p_entry_tolerance_minutes, p_effective_from, p_effective_to, p_revision_of
  ) returning * into saved;

  for day_input in select * from jsonb_to_recordset(p_days) as d(
      weekday smallint, start_local time, end_local time,
      scheduled_minutes integer, breaks jsonb
  ) loop
    insert into public.schedule_template_days(
      company_id, template_id, iso_weekday, start_local, end_local, scheduled_minutes
    ) values (
      p_company_id, saved.id, day_input.weekday,
      day_input.start_local, day_input.end_local, day_input.scheduled_minutes
    ) returning id into day_id;

    if jsonb_typeof(coalesce(day_input.breaks, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(day_input.breaks, '[]'::jsonb)) > 8 then
      raise exception 'each day may define up to eight breaks' using errcode = '22023';
    end if;

    for break_input in select * from jsonb_to_recordset(coalesce(day_input.breaks, '[]'::jsonb)) as b(
        name text, planned_start_local time, planned_end_local time,
        planned_minutes integer, counts_as_work boolean, requires_qr boolean,
        required boolean, max_minutes integer
    ) loop
      rule_code := 'sched_' || replace(gen_random_uuid()::text, '-', '');
      insert into public.break_rules(
        company_id, code, name, effective_from, effective_to,
        counts_as_work, required, max_minutes, requires_qr
      ) values (
        p_company_id, rule_code, trim(break_input.name), p_effective_from, p_effective_to,
        break_input.counts_as_work, coalesce(break_input.required,false), break_input.max_minutes,
        coalesce(break_input.requires_qr,false)
      ) returning id into rule_id;

      insert into public.schedule_template_breaks(
        company_id, template_day_id, break_rule_id, planned_start_local,
        planned_end_local, planned_minutes
      ) values (
        p_company_id, day_id, rule_id, break_input.planned_start_local,
        break_input.planned_end_local, break_input.planned_minutes
      );
    end loop;
  end loop;

  if p_revision_of is not null then
    update public.schedule_templates set active = false
      where company_id = p_company_id and id = p_revision_of;
  end if;
  return saved;
end
$$;

revoke all on function public.save_schedule_template(uuid, uuid, text, public.schedule_kind, text, smallint, date, date, jsonb, uuid) from public, anon;
grant execute on function public.save_schedule_template(uuid, uuid, text, public.schedule_kind, text, smallint, date, date, jsonb, uuid) to authenticated;

-- Keep database audit coverage for all schedule configuration changes.
create trigger audit_schedule_templates after insert or update or delete on public.schedule_templates
  for each row execute function private.write_audit_log();
create trigger audit_schedule_template_days after insert or update or delete on public.schedule_template_days
  for each row execute function private.write_audit_log();
create trigger audit_schedule_template_breaks after insert or update or delete on public.schedule_template_breaks
  for each row execute function private.write_audit_log();

comment on column public.schedule_templates.workday_type is 'Configurable shift classification: day, night, or mixed; not a legal-hours limit.';
comment on column public.schedule_templates.entry_tolerance_minutes is 'Per-template late-arrival tolerance in minutes.';
comment on column public.schedule_templates.effective_from is 'Start date for this schedule version.';
comment on column public.schedule_templates.effective_to is 'Optional inclusive end date for this schedule version.';
comment on column public.schedule_templates.revision_of is 'Prior template version retained for assignment and attendance history.';
comment on table public.schedule_template_breaks is 'Planned breaks by schedule weekday; actual break times come from attendance events.';
