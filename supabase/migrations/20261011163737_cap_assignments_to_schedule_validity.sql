-- Restrict schedule changes to the transactional assignment RPC. Direct authenticated
-- writes cannot forge a time zone, branch, or validity range.
create or replace function private.normalize_schedule_assignment()
returns trigger language plpgsql set search_path = '' as $$
declare
  t public.schedule_templates%rowtype;
  b public.branches%rowtype;
  first_day public.schedule_template_days%rowtype;
begin
  if tg_op = 'UPDATE' and
     (new.company_id, new.employee_id, new.template_id, new.branch_id, new.starts_on,
      new.timezone, new.kind, new.planned_start_local, new.planned_end_local, new.planned_minutes)
     is distinct from
     (old.company_id, old.employee_id, old.template_id, old.branch_id, old.starts_on,
      old.timezone, old.kind, old.planned_start_local, old.planned_end_local, old.planned_minutes) then
    raise exception 'assignment identity is immutable; create a new assignment'
      using errcode = '23514';
  end if;

  select * into t from public.schedule_templates x
    where x.company_id = new.company_id and x.id = new.template_id;
  if not found then raise exception 'schedule template not found' using errcode = '23503'; end if;
  select * into b from public.branches x
    where x.company_id = new.company_id and x.id = new.branch_id;
  if not found or t.branch_id <> new.branch_id then
    raise exception 'schedule and branch must belong together' using errcode = '23503';
  end if;
  if new.starts_on < t.effective_from then
    raise exception 'assignment starts before schedule validity' using errcode = '23514';
  end if;
  if t.effective_to is not null then
    if new.starts_on > t.effective_to or (new.ends_on is not null and new.ends_on > t.effective_to) then
      raise exception 'assignment is outside schedule validity' using errcode = '23514';
    end if;
    new.ends_on := least(coalesce(new.ends_on, t.effective_to), t.effective_to);
  end if;
  if tg_op = 'INSERT' then
    select * into first_day from public.schedule_template_days d
      where d.company_id = new.company_id and d.template_id = new.template_id
      order by d.iso_weekday limit 1;
    if not found then raise exception 'schedule has no working days' using errcode = '23514'; end if;
    new.timezone := b.timezone;
    new.kind := t.kind;
    new.planned_start_local := first_day.start_local;
    new.planned_end_local := first_day.end_local;
    new.planned_minutes := first_day.scheduled_minutes;
  end if;
  return new;
end
$$;

create trigger schedule_assignments_normalize
  before insert or update on public.schedule_assignments
  for each row execute function private.normalize_schedule_assignment();
