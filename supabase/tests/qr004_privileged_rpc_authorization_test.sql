BEGIN;
SELECT plan(26);

-- Static audit of the effective application SECURITY DEFINER catalog in the
-- current isolated schema, including the reviewed scanner auto-authorization RPC.
-- Attendance and PIN RPCs are inspected here only.
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND p.prokind='f' AND n.nspname IN ('public','private')),47,
  'effective application catalog contains 47 SECURITY DEFINER functions');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND p.prokind='f' AND n.nspname IN ('public','private')
    AND pg_get_userbyid(p.proowner)<>'postgres'),
  'all application SECURITY DEFINER functions are owned by postgres');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND p.prokind='f' AND n.nspname IN ('public','private')
    AND NOT coalesce(p.proconfig,'{}'::text[]) @> ARRAY['search_path=""']),
  'all application SECURITY DEFINER functions pin an empty search_path');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND p.prokind='f' AND n.nspname IN ('public','private')
    AND has_function_privilege('anon',p.oid,'EXECUTE')),
  'anon cannot execute any application SECURITY DEFINER function');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.prosecdef AND p.prokind='f' AND n.nspname IN ('public','private')
    AND a.grantee=0 AND a.privilege_type='EXECUTE'),
  'PUBLIC has no direct EXECUTE grant on application SECURITY DEFINER functions');
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND p.prokind='f' AND n.nspname='public'
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')),34,
  'the 34 public application RPCs are callable by authenticated and enforce their own authorization');
SELECT ok((SELECT count(*)=5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND p.prokind='f' AND n.nspname='private'
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND p.proname IN ('can_access_branch','can_manage_branch','has_company_permission','is_company_owner','review_attendance_adjustment'))
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prosecdef AND p.prokind='f' AND n.nspname='private'
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND p.proname NOT IN ('can_access_branch','can_manage_branch','has_company_permission','is_company_owner','review_attendance_adjustment')),
  'authenticated EXECUTE in private is limited to four policy helpers and the separately scoped adjustment-review RPC');
SELECT ok(has_function_privilege('service_role','private.bootstrap_first_company(uuid,uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','private.bootstrap_first_company(uuid,uuid,text,text,text)','EXECUTE'),
  'initial company bootstrap is service_role-only');
SELECT ok(NOT has_function_privilege('anon','private.verify_employee_pin(uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','private.verify_employee_pin(uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','private.verify_employee_pin(uuid,uuid,text)','EXECUTE'),
  'PIN verifier has no direct client or service-role EXECUTE grant (static inspection only)');
SELECT ok(NOT has_function_privilege('authenticated','private.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid)','EXECUTE'),
  'internal attendance event writer has no direct authenticated EXECUTE grant (static inspection only)');
SELECT ok((SELECT has_schema_privilege('authenticated','private','USAGE'))
  AND NOT has_schema_privilege('anon','private','USAGE'),
  'private schema is usable only by authenticated/service-side roles, not anonymous users');
SELECT ok((SELECT count(*)=0 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v'
    AND NOT coalesce(c.reloptions,'{}'::text[]) @> ARRAY['security_invoker=true']),
  'all public views use security_invoker semantics');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity),
  'every public table has RLS enabled');
SELECT ok(NOT has_function_privilege('anon','public.consume_report_export_quota(uuid)','EXECUTE'),
  'anonymous role cannot call the stateful report-quota RPC');

INSERT INTO public.companies(id,name) VALUES
 ('f8100000-0000-4000-8000-000000000001','QR8 synthetic company A'),
 ('f8100000-0000-4000-8000-000000000002','QR8 synthetic company B');
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) VALUES
 ('f8200000-0000-4000-8000-000000000001','authenticated','authenticated','qr8-admin-a@example.invalid','','now()','now()','now()'),
 ('f8200000-0000-4000-8000-000000000002','authenticated','authenticated','qr8-admin-b@example.invalid','','now()','now()','now()'),
 ('f8200000-0000-4000-8000-000000000003','authenticated','authenticated','qr8-employee-a@example.invalid','','now()','now()','now()'),
 ('f8200000-0000-4000-8000-000000000004','authenticated','authenticated','qr8-inactive-admin-a@example.invalid','','now()','now()','now()'),
 ('f8200000-0000-4000-8000-000000000005','authenticated','authenticated','qr8-multi-admin@example.invalid','','now()','now()','now()'),
 ('f8200000-0000-4000-8000-000000000006','authenticated','authenticated','qr8-owner-a@example.invalid','','now()','now()','now()');
SELECT set_config('request.jwt.claims','{"role":"service_role","sub":"f8200000-0000-4000-8000-000000000006"}',true);
INSERT INTO public.company_memberships(id,company_id,user_id,role,active) VALUES
 ('f8300000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','admin',true),
 ('f8300000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000002','f8200000-0000-4000-8000-000000000002','admin',true),
 ('f8300000-0000-4000-8000-000000000003','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000003','employee',true),
 ('f8300000-0000-4000-8000-000000000004','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000004','admin',false),
 ('f8300000-0000-4000-8000-000000000005','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000005','admin',true),
 ('f8300000-0000-4000-8000-000000000006','f8100000-0000-4000-8000-000000000002','f8200000-0000-4000-8000-000000000005','admin',true),
 ('f8300000-0000-4000-8000-000000000007','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000006','owner',true);
UPDATE public.company_memberships SET active=false WHERE id='f8300000-0000-4000-8000-000000000004';
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.membership_permission_overrides(company_id,membership_id,permission_code,allowed)
 VALUES ('f8100000-0000-4000-8000-000000000001','f8300000-0000-4000-8000-000000000001','reports.read',false);

-- Fixture rows are seeded locally; RPC calls below execute as anon or
-- authenticated with synthetic JWT claims. Denials are checked before the
-- quota table changes; the transaction is rolled back.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT throws_ok($$SELECT * FROM public.consume_report_export_quota('f8100000-0000-4000-8000-000000000001')$$,'42501',NULL,
  'anonymous invocation is rejected');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200000-0000-4000-8000-000000000001"}',true);
SELECT throws_ok($$SELECT * FROM public.consume_report_export_quota('f8100000-0000-4000-8000-000000000001')$$,'42501',NULL,
  'company A admin with reports.read explicitly revoked is rejected');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM private.report_export_rate_limits WHERE user_id='f8200000-0000-4000-8000-000000000001'),0,
  'explicit permission denial creates no quota row');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200000-0000-4000-8000-000000000002"}',true);
SELECT throws_ok($$SELECT * FROM public.consume_report_export_quota('f8100000-0000-4000-8000-000000000001')$$,'42501',NULL,
  'company B admin cannot consume company A quota');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200000-0000-4000-8000-000000000003"}',true);
SELECT throws_ok($$SELECT * FROM public.consume_report_export_quota('f8100000-0000-4000-8000-000000000001')$$,'42501',NULL,
  'employee role cannot consume report-export quota');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200000-0000-4000-8000-000000000004"}',true);
SELECT throws_ok($$SELECT * FROM public.consume_report_export_quota('f8100000-0000-4000-8000-000000000001')$$,'42501',NULL,
  'inactive admin membership cannot consume report-export quota');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM private.report_export_rate_limits
  WHERE user_id IN ('f8200000-0000-4000-8000-000000000002','f8200000-0000-4000-8000-000000000003','f8200000-0000-4000-8000-000000000004')),0,
  'cross-company, wrong-role, and inactive-membership denials create no quota rows');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200000-0000-4000-8000-000000000005"}',true);
SELECT is((SELECT allowed FROM public.consume_report_export_quota('f8100000-0000-4000-8000-000000000001')),true,
  'multi-company admin can consume quota in company A with active authorization');
SELECT is((SELECT allowed FROM public.consume_report_export_quota('f8100000-0000-4000-8000-000000000002')),true,
  'same user can independently consume quota in company B with active authorization');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f8200000-0000-4000-8000-000000000006"}',true);
SELECT is((SELECT allowed FROM public.consume_report_export_quota('f8100000-0000-4000-8000-000000000001')),true,
  'owner A retains authorized access to its company quota');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM private.report_export_rate_limits WHERE user_id='f8200000-0000-4000-8000-000000000005'),2,
  'authorized multi-company calls create one isolated quota row per company');
SELECT is((SELECT count(*)::integer FROM private.report_export_rate_limits WHERE user_id='f8200000-0000-4000-8000-000000000006'),1,
  'owner quota access creates only its authorized company row');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
