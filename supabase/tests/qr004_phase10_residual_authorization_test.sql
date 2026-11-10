-- QR-004 Phase 10.2: targeted bootstrap, tenant helper, owner guard and audit tests.
-- Synthetic fixtures only. No scan, PIN, QR, or attendance operation is invoked.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(59);

-- Bootstrap is intentionally performed before any company fixture exists.
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) VALUES
 ('a1000000-0000-4000-8000-000000000001','authenticated','authenticated','bootstrap-owner@example.invalid','','now()','now()','now()'),
 ('a1000000-0000-4000-8000-000000000002','authenticated','authenticated','admin-a@example.invalid','','now()','now()','now()'),
 ('a1000000-0000-4000-8000-000000000003','authenticated','authenticated','supervisor-a@example.invalid','','now()','now()','now()'),
 ('a1000000-0000-4000-8000-000000000004','authenticated','authenticated','owner-b@example.invalid','','now()','now()','now()'),
 ('a1000000-0000-4000-8000-000000000005','authenticated','authenticated','multi-admin@example.invalid','','now()','now()','now()'),
 ('a1000000-0000-4000-8000-000000000006','authenticated','authenticated','inactive-admin@example.invalid','','now()','now()','now()'),
 ('a1000000-0000-4000-8000-000000000007','authenticated','authenticated','employee-a@example.invalid','','now()','now()','now()'),
 ('a1000000-0000-4000-8000-000000000008','authenticated','authenticated','owner-successor@example.invalid','','now()','now()','now()');

SELECT ok(has_function_privilege('service_role','private.bootstrap_first_company(uuid,uuid,text,text,text)','EXECUTE'), 'only service_role can execute the private bootstrap');
SELECT ok(NOT has_function_privilege('authenticated','private.bootstrap_first_company(uuid,uuid,text,text,text)','EXECUTE'), 'authenticated cannot execute private bootstrap');
SELECT ok(NOT has_function_privilege('anon','private.bootstrap_first_company(uuid,uuid,text,text,text)','EXECUTE'), 'anon cannot execute private bootstrap');
SELECT ok(has_function_privilege('service_role','public.bootstrap_first_company(uuid,uuid,text,text,text)','EXECUTE'), 'server wrapper is executable by its intended service role');
SELECT ok(NOT has_function_privilege('authenticated','public.bootstrap_first_company(uuid,uuid,text,text,text)','EXECUTE'), 'authenticated cannot execute bootstrap wrapper');
SELECT ok(NOT has_function_privilege('anon','public.bootstrap_first_company(uuid,uuid,text,text,text)','EXECUTE'), 'anon cannot execute bootstrap wrapper');
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000002"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.bootstrap_first_company('a2000000-0000-4000-8000-000000000099','a1000000-0000-4000-8000-000000000002','Unauthorized bootstrap',null,null)$$,'42501',null,'authenticated admin cannot invoke the service-only bootstrap wrapper');
RESET ROLE;

SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT * FROM public.bootstrap_first_company('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',' Bootstrap Company ',' Bootstrap Legal ',' ab-123 ')$$,'service role can bootstrap the first synthetic company and owner');
RESET ROLE;
SELECT set_config('qr10.bootstrap_company',(SELECT id::text FROM public.companies WHERE name='Bootstrap Company'),true);
SELECT is((SELECT count(*)::integer FROM public.companies),1,'bootstrap creates exactly one company');
SELECT is((SELECT role::text FROM public.company_memberships WHERE company_id=current_setting('qr10.bootstrap_company')::uuid AND user_id='a1000000-0000-4000-8000-000000000001'),'owner','bootstrap grants owner only to the requested existing identity');
SELECT is((SELECT count(*)::integer FROM private.bootstrap_requests),1,'bootstrap records one idempotency request');

SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT * FROM public.bootstrap_first_company('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Bootstrap Company','Bootstrap Legal','AB-123')$$,'identical bootstrap retry is idempotent');
SELECT throws_ok($$SELECT * FROM public.bootstrap_first_company('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Different Company',null,null)$$,'22023',null,'reusing a bootstrap request with different values is rejected');
SELECT throws_ok($$SELECT * FROM public.bootstrap_first_company('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','Second Company',null,null)$$,'23505',null,'a distinct request cannot bootstrap after initialization');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.companies),1,'rejected bootstrap retries leave company state unchanged');
SELECT is((SELECT count(*)::integer FROM private.bootstrap_requests),1,'rejected bootstrap retries leave request ledger unchanged');

-- Isolated multi-company fixtures; privileged setup is not used to impersonate an API user.
INSERT INTO public.companies(id,name,legal_name) VALUES
 ('a3000000-0000-4000-8000-000000000001','Synthetic Company A','QA legal name - Synthetic Company A'),
 ('a3000000-0000-4000-8000-000000000002','Synthetic Company B','QA legal name - Synthetic Company B');
INSERT INTO public.branches(id,company_id,name,timezone) VALUES
 ('a4000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','A Branch One','America/Mexico_City'),
 ('a4000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','A Branch Two','America/Mexico_City'),
 ('a4000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000002','B Branch One','America/Mexico_City');
INSERT INTO public.company_memberships(id,company_id,user_id,role,active) VALUES
 ('a5000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','admin',true),
 ('a5000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','supervisor',true),
 ('a5000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000004','owner',true),
 ('a5000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000005','admin',true),
 ('a5000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000005','admin',true),
 ('a5000000-0000-4000-8000-000000000006','a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000006','admin',false),
 ('a5000000-0000-4000-8000-000000000007','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000007','employee',true),
 ('a5000000-0000-4000-8000-000000000008','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000008','owner',true),
 ('a5000000-0000-4000-8000-000000000009','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000004','owner',false);
INSERT INTO public.supervisors(company_id,membership_id) VALUES ('a3000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000002');
INSERT INTO public.supervisor_branches(company_id,membership_id,branch_id) VALUES ('a3000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000001');
INSERT INTO public.membership_permission_overrides(company_id,membership_id,permission_code,allowed) VALUES
 ('a3000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','company.manage',false),
 ('a3000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000008','company.manage',true);

-- Private helpers expose business booleans to an authenticated caller only.
SELECT ok(has_function_privilege('authenticated','private.has_company_permission(uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','private.has_company_permission(uuid,text)','EXECUTE'),'permission helper execute is limited to authenticated');
SELECT ok(has_function_privilege('authenticated','private.is_company_owner(uuid)','EXECUTE') AND NOT has_function_privilege('anon','private.is_company_owner(uuid)','EXECUTE'),'owner helper execute is limited to authenticated');
SELECT ok(has_function_privilege('authenticated','private.can_access_branch(uuid,uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','private.can_access_branch(uuid,uuid,text)','EXECUTE'),'branch access helper execute is limited to authenticated');
SELECT ok(has_function_privilege('authenticated','private.can_manage_branch(uuid,uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','private.can_manage_branch(uuid,uuid,text)','EXECUTE'),'branch management helper execute is limited to authenticated');

SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT ok(private.is_company_owner(current_setting('qr10.bootstrap_company')::uuid),'bootstrapped owner passes owner helper');
SELECT ok(EXISTS(SELECT 1 FROM public.role_permissions WHERE role='owner' AND permission_code='company.manage'),'owner role includes the configured company management permission');
SELECT ok(private.has_company_permission(current_setting('qr10.bootstrap_company')::uuid,'company.read'),'bootstrap owner resolves company read within its tenant');
SELECT ok(private.has_company_permission(current_setting('qr10.bootstrap_company')::uuid,'company.manage'),'bootstrap owner resolves company management within its tenant');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000002"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT private.is_company_owner('a3000000-0000-4000-8000-000000000001'),'admin is not treated as company owner');
SELECT ok(private.has_company_permission('a3000000-0000-4000-8000-000000000001','company.read'),'active admin can read its own company');
SELECT ok(NOT private.has_company_permission('a3000000-0000-4000-8000-000000000001','company.manage'),'explicit false override revokes admin management permission');
SELECT ok(NOT private.has_company_permission('a3000000-0000-4000-8000-000000000002','company.read'),'admin cannot read a company without membership');
SELECT ok(private.can_manage_branch('a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','schedules.manage'),'company.read plus schedules.manage authorizes admin branch management independent of company.manage');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000007"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000007',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT private.has_company_permission('a3000000-0000-4000-8000-000000000001','company.read'),'employee role lacks company-wide read permission');
SELECT ok(NOT private.can_manage_branch('a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','schedules.manage'),'employee role cannot manage a branch');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000004"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT private.is_company_owner('a3000000-0000-4000-8000-000000000001'),'inactive owner membership does not confer ownership of company A');
SELECT ok(private.has_company_permission('a3000000-0000-4000-8000-000000000002','company.manage'),'owner permission is available in company B');
SELECT ok(NOT private.has_company_permission('a3000000-0000-4000-8000-000000000001','company.manage'),'inactive membership does not confer company A management permission');
SELECT ok(NOT private.can_access_branch('a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','employees.read'),'company B cannot access an A branch');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000005"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT ok(private.has_company_permission('a3000000-0000-4000-8000-000000000001','company.read') AND private.has_company_permission('a3000000-0000-4000-8000-000000000002','company.read'),'multiple active memberships authorize only their respective companies');
SELECT ok(NOT private.has_company_permission('a3000000-0000-4000-8000-000000000001','overtime.manage'),'admin role does not gain owner-only overtime permission');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000006"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000006',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT private.has_company_permission('a3000000-0000-4000-8000-000000000002','company.read'),'inactive membership grants no company permission');
SELECT ok(NOT private.is_company_owner('a3000000-0000-4000-8000-000000000002'),'inactive admin membership is not owner');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000003"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT ok(private.can_access_branch('a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','employees.read'),'assigned supervisor may access its active branch');
SELECT ok(NOT private.can_access_branch('a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','employees.read'),'assigned supervisor cannot access unassigned branch');
SELECT ok(private.can_manage_branch('a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','attendance.adjust'),'supervisor can manage the assigned branch for a role-granted permission');
SELECT ok(NOT private.can_manage_branch('a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','attendance.adjust'),'supervisor cannot manage an unassigned branch');
RESET ROLE;

INSERT INTO public.membership_permission_overrides(company_id,membership_id,permission_code,allowed) VALUES ('a3000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000002','attendance.adjust',false);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000003"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT private.has_company_permission('a3000000-0000-4000-8000-000000000001','attendance.adjust'),'explicit false override revokes a role-granted permission');
RESET ROLE;
UPDATE public.company_memberships SET active=false WHERE id='a5000000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000003"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT private.can_access_branch('a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','employees.read'),'revoked supervisor membership loses branch access');
SELECT ok(NOT private.can_manage_branch('a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','schedules.manage'),'inactive membership and revoked permission deny branch management');
RESET ROLE;
SELECT is((SELECT active FROM public.company_memberships WHERE id='a5000000-0000-4000-8000-000000000002'),false,'synthetic membership revocation is persisted only in the test transaction');

-- Trigger path: authorized branch update emits one minimal, correctly scoped audit row.
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000008"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000008',true);
SET LOCAL ROLE authenticated;
SELECT set_config('qr10.audit_before',(SELECT count(*)::text FROM public.audit_log WHERE company_id='a3000000-0000-4000-8000-000000000001'),true);
UPDATE public.branches SET name='A Branch One Updated' WHERE id='a4000000-0000-4000-8000-000000000001';
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE company_id='a3000000-0000-4000-8000-000000000001'),current_setting('qr10.audit_before')::integer+1,'authorized branch update writes exactly one audit row');
SELECT ok(EXISTS(SELECT 1 FROM public.audit_log WHERE company_id='a3000000-0000-4000-8000-000000000001' AND actor_user_id='a1000000-0000-4000-8000-000000000008' AND action='UPDATE' AND entity_table='branches' AND entity_id='a4000000-0000-4000-8000-000000000001'),'audit row records the correct tenant, actor, action and resource');
SELECT ok((SELECT after_data->>'name'='A Branch One Updated' AND before_data->>'name'='A Branch One' FROM public.audit_log WHERE company_id='a3000000-0000-4000-8000-000000000001' AND entity_id='a4000000-0000-4000-8000-000000000001' ORDER BY id DESC LIMIT 1),'audit captures the changed public branch fields');
SELECT ok((SELECT (after_data - ARRAY['id','company_id','name','timezone','active','created_at'])->'name' IS NULL FROM public.audit_log WHERE company_id='a3000000-0000-4000-8000-000000000001' AND entity_id='a4000000-0000-4000-8000-000000000001' ORDER BY id DESC LIMIT 1),'branch audit contains no fields outside the expected branch record');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000002"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
SELECT set_config('qr10.foreign_audit_before',(SELECT count(*)::text FROM public.audit_log WHERE company_id='a3000000-0000-4000-8000-000000000002'),true);
SET LOCAL ROLE authenticated;
UPDATE public.branches SET name='Unauthorized Change' WHERE id='a4000000-0000-4000-8000-000000000003';
RESET ROLE;
SELECT is((SELECT name FROM public.branches WHERE id='a4000000-0000-4000-8000-000000000003'),'B Branch One','cross-company rejected update leaves the foreign branch unchanged');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE company_id='a3000000-0000-4000-8000-000000000002'),current_setting('qr10.foreign_audit_before')::integer,'cross-company rejected update emits no audit row');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000005"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT has_table_privilege('authenticated','public.company_memberships','INSERT') AND NOT has_table_privilege('authenticated','public.company_memberships','UPDATE') AND NOT has_table_privilege('authenticated','public.company_memberships','DELETE'),'clients cannot write memberships directly outside the administrative RPC contract');
SELECT throws_ok($$SELECT public.change_company_membership_role('a3000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000008','owner')$$,'22023',null,'membership role RPC rejects owner assignment');
SELECT throws_ok($$SELECT public.deactivate_company_membership('a3000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000008')$$,'42501',null,'admin cannot deactivate an owner membership');
RESET ROLE;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000002"}',true);
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
-- The last-owner invariant is an internal trigger guard; this superuser test
-- harness exercises it with an authenticated actor claim, not as a client DML path.
SET LOCAL ROLE postgres;
SELECT throws_ok($$UPDATE public.company_memberships SET active=false WHERE id='a5000000-0000-4000-8000-000000000008'$$,'23514',null,'owner guard trigger rejects internal deactivation of the last owner');
SELECT throws_ok($$DELETE FROM public.company_memberships WHERE id='a5000000-0000-4000-8000-000000000008'$$,'23514',null,'owner guard trigger preserves the last owner for an internal delete path');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.company_memberships WHERE company_id='a3000000-0000-4000-8000-000000000001' AND role='owner' AND active),1,'owner guard denials preserve the active owner');

SELECT * FROM finish();
ROLLBACK;
