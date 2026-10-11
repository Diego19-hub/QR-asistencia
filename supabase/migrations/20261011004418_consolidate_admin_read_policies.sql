-- These tables already have ALL policies tied to management permissions.
-- The ALL policy also grants SELECT through its USING expression, making the
-- broader company.read policy redundant for owners/admins and avoiding duplicate
-- permissive SELECT policy evaluation.
drop policy tenant_select on public.break_rules;
drop policy pay_period_rules_read on public.company_pay_period_rules;
drop policy tenant_select on public.labor_rule_sets;
drop policy tenant_select on public.membership_permission_overrides;
drop policy tenant_select on public.overtime_authorizations;
drop policy tenant_select on public.schedule_assignments;
drop policy tenant_select on public.schedule_template_days;
drop policy tenant_select on public.schedule_templates;
drop policy tenant_select on public.supervisor_branches;
drop policy tenant_select on public.supervisors;
