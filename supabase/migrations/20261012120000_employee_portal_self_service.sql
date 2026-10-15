-- Employee portal: allow an active employee membership to read only the rows
-- linked to auth.uid(). No attendance writes or QR token material are exposed.

create or replace function public.current_user_has_company_permission(
  p_company_id uuid,
  p_permission text
) returns boolean
language sql stable security invoker set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists (select 1 from public.permissions p where p.code = p_permission)
    and private.has_company_permission(p_company_id, p_permission);
$$;
revoke all on function public.current_user_has_company_permission(uuid,text) from public, anon;
grant execute on function public.current_user_has_company_permission(uuid,text) to authenticated;

create or replace function public.get_own_employee_credential_status(
  p_company_id uuid,
  p_employee_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  issued_at_value timestamptz;
  revoked_at_value timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.company_memberships m
    join public.employees e on e.company_id = m.company_id
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'employee'
      and e.id = p_employee_id
      and e.auth_user_id = (select auth.uid())
      and e.active
  ) then
    raise exception 'employee profile unavailable' using errcode = '42501';
  end if;

  select q.issued_at, q.revoked_at into issued_at_value, revoked_at_value
  from private.employee_qr_tokens q
  where q.employee_id = p_employee_id;

  if not found then
    return jsonb_build_object('status', 'not_issued', 'issuedAt', null, 'revokedAt', null);
  end if;
  return jsonb_build_object(
    'status', case when revoked_at_value is null then 'active' else 'revoked' end,
    'issuedAt', issued_at_value,
    'revokedAt', revoked_at_value
  );
end;
$$;
revoke all on function public.get_own_employee_credential_status(uuid,uuid) from public, anon;
grant execute on function public.get_own_employee_credential_status(uuid,uuid) to authenticated;

-- Tighten the existing self-read policies so a linked but inactive membership
-- cannot keep using the employee portal through direct PostgREST requests.
drop policy if exists employees_scoped_read on public.employees;
create policy employees_scoped_read on public.employees for select to authenticated using (
  private.can_access_branch(company_id, branch_id, 'employees.read')
  or (auth_user_id = (select auth.uid()) and exists (
    select 1 from public.company_memberships m
    where m.company_id = employees.company_id and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee'
  ))
);

create policy employee_own_company_read on public.companies for select to authenticated using (
  exists (select 1 from public.company_memberships m
    where m.company_id = companies.id and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee')
);

drop policy if exists sessions_scoped_read on public.attendance_sessions;
create policy sessions_scoped_read on public.attendance_sessions for select to authenticated using (
  private.can_access_branch(company_id, branch_id, 'attendance.read')
  or exists (
    select 1 from public.employees e
    join public.company_memberships m on m.company_id = e.company_id
    where e.company_id = attendance_sessions.company_id and e.id = attendance_sessions.employee_id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee'
  )
);

drop policy if exists events_scoped_read on public.attendance_events;
create policy events_scoped_read on public.attendance_events for select to authenticated using (
  exists (select 1 from public.attendance_sessions s
    where s.company_id = attendance_events.company_id and s.id = attendance_events.session_id
      and private.can_access_branch(s.company_id, s.branch_id, 'attendance.read'))
  or exists (
    select 1 from public.attendance_sessions s
    join public.employees e on e.company_id = s.company_id and e.id = s.employee_id
    join public.company_memberships m on m.company_id = e.company_id
    where s.company_id = attendance_events.company_id and s.id = attendance_events.session_id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee'
  )
);

drop policy if exists breaks_scoped_read on public.attendance_breaks;
create policy breaks_scoped_read on public.attendance_breaks for select to authenticated using (
  exists (select 1 from public.attendance_sessions s
    where s.company_id = attendance_breaks.company_id and s.id = attendance_breaks.session_id
      and private.can_access_branch(s.company_id, s.branch_id, 'attendance.read'))
  or exists (
    select 1 from public.attendance_sessions s
    join public.employees e on e.company_id = s.company_id and e.id = s.employee_id
    join public.company_memberships m on m.company_id = e.company_id
    where s.company_id = attendance_breaks.company_id and s.id = attendance_breaks.session_id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee'
  )
);

create policy employee_own_branch_read on public.branches for select to authenticated using (
  exists (select 1 from public.employees e
    join public.company_memberships m on m.company_id = e.company_id
    where e.company_id = branches.company_id and e.branch_id = branches.id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee')
  or exists (select 1 from public.schedule_assignments a
    join public.employees e on e.company_id = a.company_id and e.id = a.employee_id
    join public.company_memberships m on m.company_id = e.company_id
    where a.company_id = branches.company_id and a.branch_id = branches.id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee')
);

create policy employee_own_assignments_read on public.schedule_assignments for select to authenticated using (
  exists (select 1 from public.employees e
    join public.company_memberships m on m.company_id = e.company_id
    where e.company_id = schedule_assignments.company_id and e.id = schedule_assignments.employee_id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee')
);

create policy employee_own_templates_read on public.schedule_templates for select to authenticated using (
  exists (select 1 from public.schedule_assignments a
    join public.employees e on e.company_id = a.company_id and e.id = a.employee_id
    join public.company_memberships m on m.company_id = e.company_id
    where a.company_id = schedule_templates.company_id and a.template_id = schedule_templates.id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee')
);

create policy employee_own_template_days_read on public.schedule_template_days for select to authenticated using (
  exists (select 1 from public.schedule_assignments a
    join public.employees e on e.company_id = a.company_id and e.id = a.employee_id
    join public.company_memberships m on m.company_id = e.company_id
    where a.company_id = schedule_template_days.company_id and a.template_id = schedule_template_days.template_id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee')
);

create policy employee_own_template_breaks_read on public.schedule_template_breaks for select to authenticated using (
  exists (select 1 from public.schedule_template_days d
    join public.schedule_assignments a on a.company_id = d.company_id and a.template_id = d.template_id
    join public.employees e on e.company_id = a.company_id and e.id = a.employee_id
    join public.company_memberships m on m.company_id = e.company_id
    where d.company_id = schedule_template_breaks.company_id and d.id = schedule_template_breaks.template_day_id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee')
);

create policy employee_own_break_rules_read on public.break_rules for select to authenticated using (
  exists (select 1 from public.schedule_template_breaks b
    join public.schedule_template_days d on d.company_id = b.company_id and d.id = b.template_day_id
    join public.schedule_assignments a on a.company_id = d.company_id and a.template_id = d.template_id
    join public.employees e on e.company_id = a.company_id and e.id = a.employee_id
    join public.company_memberships m on m.company_id = e.company_id
    where b.company_id = break_rules.company_id and b.break_rule_id = break_rules.id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee')
);

create policy employee_own_overtime_authorizations_read on public.overtime_authorizations
for select to authenticated using (
  exists (select 1 from public.attendance_sessions s
    join public.employees e on e.company_id = s.company_id and e.id = s.employee_id
    join public.company_memberships m on m.company_id = e.company_id
    where s.company_id = overtime_authorizations.company_id and s.id = overtime_authorizations.session_id
      and e.auth_user_id = (select auth.uid()) and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee')
);

comment on function public.get_own_employee_credential_status(uuid,uuid)
  is 'Returns only QR credential status for the authenticated employee linked to an active employee membership; never returns token material.';
