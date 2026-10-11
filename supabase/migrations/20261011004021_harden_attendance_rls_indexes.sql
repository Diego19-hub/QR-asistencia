-- Close RLS gaps reported by the Supabase security advisor.
alter table public.companies enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

-- The public invoker wrapper delegates to this private, tightly scoped routine.
grant execute on function private.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid) to authenticated;

-- Cover tenant-scoped foreign keys and auth-user references reported by the
-- performance advisor. Existing composite session/event indexes are retained.
create index attendance_adjustments_company_session_idx on public.attendance_adjustments(company_id,session_id);
create index attendance_adjustments_requested_by_idx on public.attendance_adjustments(requested_by);
create index attendance_adjustments_reviewed_by_idx on public.attendance_adjustments(reviewed_by);
create index attendance_breaks_company_rule_idx on public.attendance_breaks(company_id,break_rule_id);
create index attendance_breaks_company_end_event_idx on public.attendance_breaks(company_id,end_event_id);
create index attendance_breaks_company_start_event_idx on public.attendance_breaks(company_id,start_event_id);
create index attendance_events_company_device_idx on public.attendance_events(company_id,device_id);
create index attendance_events_recorded_by_idx on public.attendance_events(recorded_by);
create index attendance_sessions_company_assignment_idx on public.attendance_sessions(company_id,assignment_id);
create index attendance_sessions_company_branch_idx on public.attendance_sessions(company_id,branch_id);
create index attendance_sessions_company_rules_idx on public.attendance_sessions(company_id,labor_rule_set_id);
create index audit_log_actor_user_idx on public.audit_log(actor_user_id);
create index authorized_devices_company_branch_idx on public.authorized_devices(company_id,branch_id);
create index authorized_devices_company_membership_idx on public.authorized_devices(company_id,membership_id);
create index company_memberships_user_idx on public.company_memberships(user_id);
create index employees_auth_user_idx on public.employees(auth_user_id);
create index employees_company_branch_idx on public.employees(company_id,branch_id);
create index membership_overrides_company_membership_idx on public.membership_permission_overrides(company_id,membership_id);
create index membership_overrides_permission_idx on public.membership_permission_overrides(permission_code);
create index overtime_assessments_company_rules_idx on public.overtime_assessments(company_id,rule_set_id);
create index overtime_authorizations_company_session_idx on public.overtime_authorizations(company_id,session_id);
create index overtime_authorizations_decided_by_idx on public.overtime_authorizations(decided_by);
create index overtime_authorizations_requested_by_idx on public.overtime_authorizations(requested_by);
create index role_permissions_code_idx on public.role_permissions(permission_code);
create index schedule_assignments_company_branch_idx on public.schedule_assignments(company_id,branch_id);
create index schedule_assignments_company_template_idx on public.schedule_assignments(company_id,template_id);
create index schedule_template_days_company_template_idx on public.schedule_template_days(company_id,template_id);
create index schedule_templates_company_branch_idx on public.schedule_templates(company_id,branch_id);
create index supervisor_branches_company_branch_idx on public.supervisor_branches(company_id,branch_id);
create index supervisor_branches_company_membership_idx on public.supervisor_branches(company_id,membership_id);
create index supervisors_company_employee_idx on public.supervisors(company_id,employee_id);
