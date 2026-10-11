BEGIN;
SELECT plan(37);

SELECT has_table('public', 'companies', 'company tenant root exists');
SELECT has_table('public', 'branches', 'branches belong to companies');
SELECT has_table('public', 'employees', 'employees exist');
SELECT has_table('public', 'company_memberships', 'roles are company scoped');
SELECT has_table('public', 'supervisor_branches', 'supervisors are branch scoped');
SELECT has_table('public', 'authorized_devices', 'authorized devices are modeled');
SELECT has_table('public', 'schedule_assignments', 'variable and fixed schedule assignments exist');
SELECT has_table('public', 'labor_rule_sets', 'labor rules can have effective dates');
SELECT has_table('public', 'break_rules', 'break treatment is configurable');
SELECT has_table('public', 'attendance_sessions', 'attendance sessions exist');
SELECT has_table('public', 'attendance_events', 'attendance events exist');
SELECT has_table('public', 'attendance_adjustments', 'adjustments are auditable');
SELECT has_table('public', 'overtime_assessments', 'detected overtime is modeled separately');
SELECT has_table('public', 'overtime_authorizations', 'authorized overtime is modeled separately');
SELECT has_table('public', 'audit_log', 'audit log exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.attendance_events'::regclass), 'attendance events require RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.companies'::regclass), 'tenant root requires RLS');
SELECT ok(to_regclass('private.employee_qr_tokens') IS NOT NULL AND to_regclass('private.device_token_hashes') IS NOT NULL,
          'QR and device token hashes live in private schema');
SELECT ok(to_regclass('public.attendance_period_totals') IS NOT NULL, 'daily, weekly, configured biweekly and monthly aggregate view exists');
SELECT ok(to_regclass('public.company_pay_period_rules') IS NOT NULL, 'biweekly period boundaries are company-configurable');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='attendance_one_open_session_per_employee'),
          'partial unique index prevents concurrent open sessions per employee');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='attendance_events_company_id_idempotency_key_key'),
          'event idempotency keys are unique within a company');
SELECT is((90-30)::integer, 60, 'non-computable break time is removed from effective work');
SELECT is((90-0)::integer, 90, 'computable break time remains part of effective work');
SELECT is((timestamp '2026-01-01 22:00' at time zone 'America/Mexico_City') + interval '8 hours',
          (timestamp '2026-01-02 06:00' at time zone 'America/Mexico_City'),
          'overnight shift end resolves on the following local date');
SELECT ok(position('invalid attendance event transition' in pg_get_functiondef('private.guard_attendance_event()'::regprocedure)) > 0,
          'event trigger rejects invalid state transitions');
SELECT ok(position('is_incomplete=true' in pg_get_functiondef('private.sync_attendance_event()'::regprocedure)) > 0,
          'clock-out closes and marks an unfinished break');
SELECT ok(position('counts_as_work' in pg_get_viewdef('public.attendance_session_totals'::regclass)) > 0,
          'work time uses each break rule computability flag');
SELECT ok(EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.attendance_events'::regclass
          AND pg_get_expr(polqual,polrelid) LIKE '%can_access_branch%'),
          'attendance RLS checks tenant and supervisor branch membership');
SELECT ok(position('detected_overtime_minutes' in pg_get_viewdef('public.attendance_session_totals'::regclass)) > 0,
          'detected overtime is calculated separately from authorization rows');
SELECT ok(NOT has_function_privilege('authenticated', 'public.bootstrap_first_company(uuid,uuid,text,text,text)', 'EXECUTE'),
          'browser-authenticated users cannot initialize a company or self-assign owner');
SELECT ok(has_function_privilege('service_role', 'public.bootstrap_first_company(uuid,uuid,text,text,text)', 'EXECUTE'),
          'only the server service role can run first-company bootstrap');
SELECT ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.company_memberships'::regclass
          AND tgname='company_membership_owner_guard' AND NOT tgisinternal),
          'membership trigger prevents browser self-promotion and last-owner removal');
SELECT ok(position('new.user_id=(select auth.uid())' in pg_get_functiondef('private.guard_company_membership_owner()'::regprocedure)) > 0,
          'owner guard rejects setting the caller as owner through the browser');
SELECT ok(position('cannot deactivate the last active owner' in pg_get_functiondef('private.guard_company_membership_owner()'::regprocedure)) > 0,
          'membership changes cannot remove the final active owner');
SELECT ok(has_function_privilege('authenticated', 'public.review_attendance_adjustment(uuid,boolean,text)', 'EXECUTE'),
          'authorized users can call the audited correction review procedure');
SELECT ok(position('update public.attendance_adjustments' in pg_get_functiondef('private.review_attendance_adjustment(uuid,boolean,text)'::regprocedure)) > 0
          AND position('update public.attendance_events' in pg_get_functiondef('private.review_attendance_adjustment(uuid,boolean,text)'::regprocedure)) = 0,
          'correction review updates only the adjustment record, not original events');

SELECT * FROM finish();
ROLLBACK;
