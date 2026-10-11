-- Supabase's default ACL grants DML to API roles on new public tables. Revoke
-- these capabilities explicitly; only tables listed below regain writes.
revoke insert,update,delete,truncate,references,trigger on all tables in schema public from anon,authenticated;
revoke all on all sequences in schema public from anon,authenticated;

grant update on public.companies to authenticated;
create policy companies_update on public.companies for update to authenticated
 using (private.has_company_permission(id,'company.manage'))
 with check (private.has_company_permission(id,'company.manage'));

grant insert,update,delete on public.branches to authenticated;
create policy branches_insert on public.branches for insert to authenticated
 with check (private.has_company_permission(company_id,'company.manage'));
create policy branches_update on public.branches for update to authenticated
 using (private.has_company_permission(company_id,'company.manage'))
 with check (private.has_company_permission(company_id,'company.manage'));
create policy branches_delete on public.branches for delete to authenticated
 using (private.has_company_permission(company_id,'company.manage'));

grant insert,update,delete on public.company_memberships to authenticated;
create policy memberships_insert on public.company_memberships for insert to authenticated
 with check (private.has_company_permission(company_id,'company.manage'));
create policy memberships_update on public.company_memberships for update to authenticated
 using (private.has_company_permission(company_id,'company.manage')) with check(private.has_company_permission(company_id,'company.manage'));
create policy memberships_delete on public.company_memberships for delete to authenticated
 using (private.has_company_permission(company_id,'company.manage'));

grant insert,update,delete on public.employees to authenticated;
create policy employees_insert on public.employees for insert to authenticated
 with check (private.can_access_branch(company_id,branch_id,'employees.manage'));
create policy employees_update on public.employees for update to authenticated
 using (private.can_access_branch(company_id,branch_id,'employees.manage'))
 with check (private.can_access_branch(company_id,branch_id,'employees.manage'));
create policy employees_delete on public.employees for delete to authenticated
 using (private.can_access_branch(company_id,branch_id,'employees.manage'));

grant insert,update,delete on public.membership_permission_overrides,public.supervisors,public.supervisor_branches to authenticated;
create policy overrides_manage on public.membership_permission_overrides for all to authenticated
 using (private.has_company_permission(company_id,'company.manage'))
 with check (private.has_company_permission(company_id,'company.manage'));
create policy supervisors_manage on public.supervisors for all to authenticated
 using (private.has_company_permission(company_id,'company.manage'))
 with check (private.has_company_permission(company_id,'company.manage'));
create policy supervisor_branches_manage on public.supervisor_branches for all to authenticated
 using (private.has_company_permission(company_id,'company.manage'))
 with check (private.has_company_permission(company_id,'company.manage'));

grant insert,update,delete on public.authorized_devices to authenticated;
create policy devices_insert on public.authorized_devices for insert to authenticated
 with check (private.can_access_branch(company_id,branch_id,'devices.manage'));
create policy devices_update on public.authorized_devices for update to authenticated
 using (private.can_access_branch(company_id,branch_id,'devices.manage'))
 with check (private.can_access_branch(company_id,branch_id,'devices.manage'));
create policy devices_delete on public.authorized_devices for delete to authenticated
 using (private.can_access_branch(company_id,branch_id,'devices.manage'));

grant insert,update,delete on public.schedule_templates,public.schedule_template_days,public.schedule_assignments to authenticated;
create policy schedule_templates_manage on public.schedule_templates for all to authenticated
 using (private.can_access_branch(company_id,branch_id,'schedules.manage'))
 with check (private.can_access_branch(company_id,branch_id,'schedules.manage'));
create policy schedule_template_days_manage on public.schedule_template_days for all to authenticated
 using (private.has_company_permission(company_id,'schedules.manage'))
 with check (private.has_company_permission(company_id,'schedules.manage'));
create policy schedule_assignments_manage on public.schedule_assignments for all to authenticated
 using (private.can_access_branch(company_id,branch_id,'schedules.manage'))
 with check (private.can_access_branch(company_id,branch_id,'schedules.manage'));

grant insert,update,delete on public.labor_rule_sets,public.break_rules,public.company_pay_period_rules to authenticated;
create policy labor_rules_manage on public.labor_rule_sets for all to authenticated
 using (private.has_company_permission(company_id,'company.manage'))
 with check (private.has_company_permission(company_id,'company.manage'));
create policy break_rules_manage on public.break_rules for all to authenticated
 using (private.has_company_permission(company_id,'company.manage'))
 with check (private.has_company_permission(company_id,'company.manage'));
create policy pay_period_rules_manage on public.company_pay_period_rules for all to authenticated
 using (private.has_company_permission(company_id,'company.manage'))
 with check (private.has_company_permission(company_id,'company.manage'));

-- Corrections can be submitted by an authorized supervisor and reviewed later;
-- no direct update is granted, preserving the audit trail until a review RPC exists.
grant insert on public.attendance_adjustments to authenticated;
drop policy tenant_select on public.attendance_adjustments;
create policy attendance_adjustments_read on public.attendance_adjustments for select to authenticated using (
 private.has_company_permission(company_id,'company.read') or
 (requested_by=(select auth.uid()) and private.has_company_permission(company_id,'attendance.adjust')) or
 private.has_company_permission(company_id,'attendance.review_adjustments'));
create policy attendance_adjustments_submit on public.attendance_adjustments for insert to authenticated
 with check (requested_by=(select auth.uid()) and private.has_company_permission(company_id,'attendance.adjust'));

grant insert,update,delete on public.overtime_authorizations to authenticated;
create policy overtime_authorizations_manage on public.overtime_authorizations for all to authenticated
 using (private.has_company_permission(company_id,'overtime.manage'))
 with check (private.has_company_permission(company_id,'overtime.manage'));

-- Attendance events/sessions/breaks, audit entries, lookup catalog and overtime
-- assessments remain write-protected; event writes go through the scan RPC.
