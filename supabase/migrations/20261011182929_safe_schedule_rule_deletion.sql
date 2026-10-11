-- Transactional, tenant-scoped hard deletion for schedules and labor rules.
-- Rows with operational references are retained and must be archived instead.

-- Force destructive parent-row changes through the guarded RPCs below. Reads,
-- inserts, updates, and the existing row-level policies remain unchanged.
revoke delete on public.schedule_templates, public.labor_rule_sets from authenticated;

create or replace function public.delete_schedule_template(
  p_company_id uuid,
  p_template_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_company_id uuid;
  schedule_break_rule_ids uuid[];
begin
  if (select auth.uid()) is null
     or not exists (
       select 1 from public.company_memberships m
       where m.company_id = p_company_id
         and m.user_id = (select auth.uid())
         and m.active
         and m.role in ('owner', 'admin')
     )
     or not private.has_company_permission(p_company_id, 'schedules.manage') then
    raise exception 'schedule deletion forbidden' using errcode = '42501';
  end if;

  select t.company_id into template_company_id
  from public.schedule_templates t
  where t.company_id = p_company_id and t.id = p_template_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  if exists (
    select 1 from public.schedule_assignments a
    where a.company_id = p_company_id and a.template_id = p_template_id
  ) then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'reason', 'assignments');
  end if;

  if exists (
    select 1 from public.schedule_templates derived
    where derived.company_id = p_company_id and derived.revision_of = p_template_id
  ) then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'reason', 'revisions');
  end if;

  select coalesce(pg_catalog.array_agg(distinct sb.break_rule_id), array[]::uuid[])
  into schedule_break_rule_ids
  from public.schedule_template_breaks sb
  join public.schedule_template_days d
    on d.company_id = sb.company_id and d.id = sb.template_day_id
  where d.company_id = p_company_id and d.template_id = p_template_id;

  -- Lock referenced break rules so a concurrent attendance_break insert either
  -- completes before the history check or fails its FK after an unused rule is removed.
  perform br.id
  from public.break_rules br
  where br.company_id = p_company_id and br.id = any(schedule_break_rule_ids)
  order by br.id
  for update;

  if exists (
    select 1 from public.attendance_breaks ab
    where ab.company_id = p_company_id and ab.break_rule_id = any(schedule_break_rule_ids)
  ) then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'reason', 'history');
  end if;

  -- Template days/breaks cascade. Audit triggers preserve their before images;
  -- assignment/session references are checked above and protected by RESTRICT FKs.
  begin
    delete from public.schedule_templates t
    where t.company_id = p_company_id and t.id = p_template_id;

    delete from public.break_rules br
    where br.company_id = p_company_id
      and br.id = any(schedule_break_rule_ids)
      and not exists (
        select 1 from public.schedule_template_breaks sb
        where sb.company_id = br.company_id and sb.break_rule_id = br.id
      )
      and not exists (
        select 1 from public.attendance_breaks ab
        where ab.company_id = br.company_id and ab.break_rule_id = br.id
      );
  exception when foreign_key_violation then
    -- Covers references committed concurrently after the explicit checks.
    return pg_catalog.jsonb_build_object('status', 'blocked', 'reason', 'history');
  end;

  return pg_catalog.jsonb_build_object('status', 'deleted');
end
$$;

revoke all on function public.delete_schedule_template(uuid, uuid) from public, anon;
grant execute on function public.delete_schedule_template(uuid, uuid) to authenticated;

create or replace function public.delete_labor_rule_set(
  p_company_id uuid,
  p_rule_set_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule_company_id uuid;
begin
  if (select auth.uid()) is null
     or not exists (
       select 1 from public.company_memberships m
       where m.company_id = p_company_id
         and m.user_id = (select auth.uid())
         and m.active
         and m.role in ('owner', 'admin')
     )
     or not private.has_company_permission(p_company_id, 'company.manage') then
    raise exception 'labor rule deletion forbidden' using errcode = '42501';
  end if;

  select r.company_id into rule_company_id
  from public.labor_rule_sets r
  where r.company_id = p_company_id and r.id = p_rule_set_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  if exists (
    select 1 from public.attendance_sessions s
    where s.company_id = p_company_id and s.labor_rule_set_id = p_rule_set_id
  ) or exists (
    select 1 from public.overtime_assessments a
    where a.company_id = p_company_id and a.rule_set_id = p_rule_set_id
  ) then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'reason', 'history');
  end if;

  -- The audit trigger keeps the deleted rule's before image for administrators.
  begin
    delete from public.labor_rule_sets r
    where r.company_id = p_company_id and r.id = p_rule_set_id;
  exception when foreign_key_violation then
    -- Covers a concurrent attendance or overtime reference.
    return pg_catalog.jsonb_build_object('status', 'blocked', 'reason', 'history');
  end;

  return pg_catalog.jsonb_build_object('status', 'deleted');
end
$$;

revoke all on function public.delete_labor_rule_set(uuid, uuid) from public, anon;
grant execute on function public.delete_labor_rule_set(uuid, uuid) to authenticated;
