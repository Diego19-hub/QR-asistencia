-- Supervisors may submit and read their own correction requests only for
-- attendance sessions in branches assigned to their active membership.
create or replace function private.can_manage_branch(p_company_id uuid, p_branch_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_company_permission(p_company_id, p_permission)
    and (
      private.has_company_permission(p_company_id, 'company.read')
      or exists (
        select 1
        from public.supervisor_branches sb
        join public.company_memberships m
          on m.company_id = sb.company_id
         and m.id = sb.membership_id
        where sb.company_id = p_company_id
          and sb.branch_id = p_branch_id
          and m.user_id = (select auth.uid())
          and m.active
      )
    );
$$;
revoke all on function private.can_manage_branch(uuid, uuid, text) from public, anon;
grant execute on function private.can_manage_branch(uuid, uuid, text) to authenticated;

drop policy attendance_adjustments_read on public.attendance_adjustments;
create policy attendance_adjustments_read on public.attendance_adjustments
  for select to authenticated
  using (
    exists (
      select 1
      from public.attendance_sessions s
      where s.company_id = attendance_adjustments.company_id
        and s.id = attendance_adjustments.session_id
        and (
          private.has_company_permission(s.company_id, 'company.read')
          or (
            attendance_adjustments.requested_by = (select auth.uid())
            and private.can_manage_branch(s.company_id, s.branch_id, 'attendance.adjust')
          )
          or private.can_manage_branch(s.company_id, s.branch_id, 'attendance.review_adjustments')
        )
    )
  );

drop policy attendance_adjustments_submit on public.attendance_adjustments;
create policy attendance_adjustments_submit on public.attendance_adjustments
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and exists (
      select 1
      from public.attendance_sessions s
      where s.company_id = attendance_adjustments.company_id
        and s.id = attendance_adjustments.session_id
        and private.can_manage_branch(s.company_id, s.branch_id, 'attendance.adjust')
    )
  );

-- A general company.read grant is not itself permission to mutate schedules.
-- Preserve all-company administration for users who have both permissions,
-- and branch scope for explicitly authorized supervisor memberships.
drop policy schedule_templates_manage on public.schedule_templates;
create policy schedule_templates_manage on public.schedule_templates
  for all to authenticated
  using (private.can_manage_branch(company_id, branch_id, 'schedules.manage'))
  with check (private.can_manage_branch(company_id, branch_id, 'schedules.manage'));

drop policy schedule_template_days_manage on public.schedule_template_days;
create policy schedule_template_days_manage on public.schedule_template_days
  for all to authenticated
  using (
    exists (
      select 1 from public.schedule_templates t
      where t.company_id = schedule_template_days.company_id
        and t.id = schedule_template_days.template_id
        and private.can_manage_branch(t.company_id, t.branch_id, 'schedules.manage')
    )
  )
  with check (
    exists (
      select 1 from public.schedule_templates t
      where t.company_id = schedule_template_days.company_id
        and t.id = schedule_template_days.template_id
        and private.can_manage_branch(t.company_id, t.branch_id, 'schedules.manage')
    )
  );

drop policy schedule_assignments_manage on public.schedule_assignments;
create policy schedule_assignments_manage on public.schedule_assignments
  for all to authenticated
  using (private.can_manage_branch(company_id, branch_id, 'schedules.manage'))
  with check (private.can_manage_branch(company_id, branch_id, 'schedules.manage'));

drop policy schedule_template_breaks_insert on public.schedule_template_breaks;
create policy schedule_template_breaks_insert on public.schedule_template_breaks
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.schedule_template_days d
      join public.schedule_templates t
        on t.company_id = d.company_id and t.id = d.template_id
      where d.company_id = schedule_template_breaks.company_id
        and d.id = schedule_template_breaks.template_day_id
        and private.can_manage_branch(t.company_id, t.branch_id, 'schedules.manage')
    )
  );
drop policy schedule_template_breaks_update on public.schedule_template_breaks;
create policy schedule_template_breaks_update on public.schedule_template_breaks
  for update to authenticated
  using (
    exists (
      select 1
      from public.schedule_template_days d
      join public.schedule_templates t
        on t.company_id = d.company_id and t.id = d.template_id
      where d.company_id = schedule_template_breaks.company_id
        and d.id = schedule_template_breaks.template_day_id
        and private.can_manage_branch(t.company_id, t.branch_id, 'schedules.manage')
    )
  )
  with check (
    exists (
      select 1
      from public.schedule_template_days d
      join public.schedule_templates t
        on t.company_id = d.company_id and t.id = d.template_id
      where d.company_id = schedule_template_breaks.company_id
        and d.id = schedule_template_breaks.template_day_id
        and private.can_manage_branch(t.company_id, t.branch_id, 'schedules.manage')
    )
  );
drop policy schedule_template_breaks_delete on public.schedule_template_breaks;
create policy schedule_template_breaks_delete on public.schedule_template_breaks
  for delete to authenticated
  using (
    exists (
      select 1
      from public.schedule_template_days d
      join public.schedule_templates t
        on t.company_id = d.company_id and t.id = d.template_id
      where d.company_id = schedule_template_breaks.company_id
        and d.id = schedule_template_breaks.template_day_id
        and private.can_manage_branch(t.company_id, t.branch_id, 'schedules.manage')
    )
  );
