BEGIN;
SELECT plan(18);

SELECT has_function('public', 'current_user_has_company_permission', ARRAY['uuid','text'], 'effective permission check is available to the app server');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.current_user_has_company_permission(uuid,text)'::regprocedure), 'permission wrapper executes with caller identity');
SELECT ok(has_function_privilege('authenticated','public.current_user_has_company_permission(uuid,text)','EXECUTE'), 'authenticated can check its own effective permission');
SELECT ok(NOT has_function_privilege('anon','public.current_user_has_company_permission(uuid,text)','EXECUTE'), 'anonymous cannot check permissions');
SELECT has_function('public', 'get_own_employee_credential_status', ARRAY['uuid','uuid'], 'employee credential status RPC exists');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid='public.get_own_employee_credential_status(uuid,uuid)'::regprocedure), 'credential status reads private storage through a definer RPC');
SELECT ok(has_function_privilege('authenticated','public.get_own_employee_credential_status(uuid,uuid)','EXECUTE'), 'authenticated can request own credential status');
SELECT ok(NOT has_function_privilege('anon','public.get_own_employee_credential_status(uuid,uuid)','EXECUTE'), 'anonymous cannot request credential status');
SELECT ok(position('employee_qr_tokens' in pg_get_functiondef('public.get_own_employee_credential_status(uuid,uuid)'::regprocedure)) > 0
  AND position('token_hash' in pg_get_functiondef('public.get_own_employee_credential_status(uuid,uuid)'::regprocedure)) = 0,
  'credential status function never selects or returns token hashes');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.schedule_assignments'::regclass), 'schedule assignments remain protected by RLS');
SELECT ok(EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.schedule_assignments'::regclass AND polname='employee_own_assignments_read' AND polcmd='r'), 'employee assignment policy is installed');
SELECT ok(EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.schedule_templates'::regclass AND polname='employee_own_templates_read' AND polcmd='r'), 'employee template policy is installed');
SELECT ok(EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.overtime_authorizations'::regclass AND polname='employee_own_overtime_authorizations_read' AND polcmd='r'), 'employee overtime policy is read-only');
SELECT ok(EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.companies'::regclass AND polname='employee_own_company_read' AND polcmd='r'), 'employee can read only its own company display data');
SELECT ok((SELECT position('auth.uid' in pg_get_expr(polqual, polrelid)) > 0
  AND position('active' in pg_get_expr(polqual, polrelid)) > 0
  AND position('employee' in pg_get_expr(polqual, polrelid)) > 0
  FROM pg_policy WHERE polrelid='public.schedule_assignments'::regclass AND polname='employee_own_assignments_read'),
  'assignment self-access requires auth identity and an active employee membership');
SELECT ok((SELECT position('auth.uid' in pg_get_expr(polqual, polrelid)) > 0
  AND position('active' in pg_get_expr(polqual, polrelid)) > 0
  AND position('employee' in pg_get_expr(polqual, polrelid)) > 0
  FROM pg_policy WHERE polrelid='public.attendance_sessions'::regclass AND polname='sessions_scoped_read'),
  'attendance self-access requires auth identity and an active employee membership');
SELECT ok(NOT has_table_privilege('authenticated','public.attendance_events','INSERT')
  AND NOT has_table_privilege('authenticated','public.attendance_sessions','INSERT'),
  'employee portal cannot write attendance and must keep the supervisor scan flow');
SELECT ok(NOT has_table_privilege('authenticated','private.employee_qr_tokens','SELECT'), 'employee portal does not expose private QR storage');

SELECT * FROM finish();
ROLLBACK;
