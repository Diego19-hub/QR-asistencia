-- JWT-claim RLS regression test with synthetic tenants and identities only.
-- Run in a disposable Supabase database; the transaction always rolls back.
BEGIN;
SELECT plan(21);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) VALUES
 ('11000000-0000-4000-8000-000000000001','authenticated','authenticated','portal-owner-a@example.invalid','','now()','now()','now()'),
 ('11000000-0000-4000-8000-000000000002','authenticated','authenticated','portal-admin-a@example.invalid','','now()','now()','now()'),
 ('11000000-0000-4000-8000-000000000003','authenticated','authenticated','portal-supervisor-a@example.invalid','','now()','now()','now()'),
 ('11000000-0000-4000-8000-000000000004','authenticated','authenticated','portal-employee-a@example.invalid','','now()','now()','now()'),
 ('11000000-0000-4000-8000-000000000005','authenticated','authenticated','portal-employee-b@example.invalid','','now()','now()','now()'),
 ('11000000-0000-4000-8000-000000000006','authenticated','authenticated','portal-employee-inactive@example.invalid','','now()','now()','now()'),
 ('11000000-0000-4000-8000-000000000007','authenticated','authenticated','portal-unlinked@example.invalid','','now()','now()','now()');

INSERT INTO public.companies (id,name) VALUES
 ('21000000-0000-4000-8000-000000000001','Portal synthetic A'),
 ('21000000-0000-4000-8000-000000000002','Portal synthetic B');
INSERT INTO public.branches (id,company_id,name,timezone) VALUES
 ('31000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Portal branch A','America/Mexico_City'),
 ('31000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','Portal branch B','America/Mexico_City');

-- The owner-only invariant is respected by creating the initial synthetic owner
-- under the service role, as the trusted bootstrap procedure does.
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO public.company_memberships (id,company_id,user_id,role,active) VALUES
 ('51000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','owner',true);
RESET ROLE;
INSERT INTO public.company_memberships (id,company_id,user_id,role,active) VALUES
 ('51000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','admin',true),
 ('51000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','supervisor',true),
 ('51000000-0000-4000-8000-000000000004','21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','employee',true),
 ('51000000-0000-4000-8000-000000000005','21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000005','employee',true),
 ('51000000-0000-4000-8000-000000000006','21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000006','employee',false);
INSERT INTO public.supervisors(company_id,membership_id) VALUES
 ('21000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003');
INSERT INTO public.supervisor_branches(company_id,membership_id,branch_id) VALUES
 ('21000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000001');

INSERT INTO public.employees(id,company_id,branch_id,employee_number,first_name,last_name,auth_user_id) VALUES
 ('41000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','PORTAL-A','Empleado','A','11000000-0000-4000-8000-000000000004'),
 ('41000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002','PORTAL-B','Empleado','B','11000000-0000-4000-8000-000000000005'),
 ('41000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','PORTAL-OFF','Vínculo','Inactivo','11000000-0000-4000-8000-000000000006');
INSERT INTO public.schedule_templates(id,company_id,branch_id,name,kind) VALUES
 ('61000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','Portal schedule A','fixed'),
 ('61000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002','Portal schedule B','fixed');
INSERT INTO public.schedule_template_days(company_id,template_id,iso_weekday,start_local,end_local,scheduled_minutes) VALUES
 ('21000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',1,'09:00','17:00',480),
 ('21000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002',1,'08:00','16:00',480);
INSERT INTO public.schedule_assignments(company_id,employee_id,template_id,branch_id,starts_on,timezone,kind,planned_start_local,planned_end_local,planned_minutes) VALUES
 ('21000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','2026-10-12','America/Mexico_City','fixed','09:00','17:00',480),
 ('21000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002','2026-10-12','America/Mexico_City','fixed','08:00','16:00',480);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
SELECT is((SELECT count(*)::integer FROM public.companies WHERE id='21000000-0000-4000-8000-000000000001'),1,'owner reads the active company');
SELECT is((SELECT count(*)::integer FROM public.companies WHERE id='21000000-0000-4000-8000-000000000002'),0,'owner cannot read another company');

SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
SELECT is((SELECT count(*)::integer FROM public.companies WHERE id='21000000-0000-4000-8000-000000000001'),1,'admin reads the active company');
SELECT is((SELECT count(*)::integer FROM public.schedule_assignments WHERE company_id='21000000-0000-4000-8000-000000000002'),0,'admin cannot read another company schedule');

SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
SELECT is((SELECT count(*)::integer FROM public.employees WHERE company_id='21000000-0000-4000-8000-000000000001'),2,'supervisor sees employees in the assigned branch');
SELECT is((SELECT count(*)::integer FROM public.employees WHERE company_id='21000000-0000-4000-8000-000000000002'),0,'supervisor cannot see another company employees');
SELECT is((SELECT count(*)::integer FROM public.schedule_assignments WHERE company_id='21000000-0000-4000-8000-000000000001'),0,'supervisor cannot read administrative schedules');

SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000004',true);
SELECT is((SELECT count(*)::integer FROM public.companies WHERE id='21000000-0000-4000-8000-000000000001'),1,'employee can read own company display data');
SELECT is((SELECT count(*)::integer FROM public.companies WHERE id='21000000-0000-4000-8000-000000000002'),0,'employee cannot read another company');
SELECT is((SELECT count(*)::integer FROM public.employees WHERE company_id='21000000-0000-4000-8000-000000000001'),1,'employee sees only its linked employee row');
SELECT is((SELECT count(*)::integer FROM public.employees WHERE company_id='21000000-0000-4000-8000-000000000002'),0,'employee cannot read another tenant employee');
SELECT is((SELECT count(*)::integer FROM public.schedule_assignments WHERE company_id='21000000-0000-4000-8000-000000000001'),1,'employee reads its own assigned schedule');
SELECT is((SELECT count(*)::integer FROM public.schedule_assignments WHERE company_id='21000000-0000-4000-8000-000000000002'),0,'employee cannot read another tenant schedule');
SELECT is(public.get_own_employee_credential_status('21000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001')->>'status','not_issued','employee sees only own credential status');
SELECT throws_ok($$SELECT public.get_own_employee_credential_status('21000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002')$$,'42501',NULL,'foreign employee credential status is rejected');
SELECT ok(NOT has_table_privilege('authenticated','public.attendance_events','INSERT') AND NOT has_table_privilege('authenticated','public.attendance_sessions','INSERT'),'employee cannot write attendance directly');

SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000005',true);
SELECT is((SELECT count(*)::integer FROM public.employees WHERE company_id='21000000-0000-4000-8000-000000000001'),0,'employee B cannot enumerate tenant A employees');
SELECT is((SELECT count(*)::integer FROM public.employees WHERE company_id='21000000-0000-4000-8000-000000000002'),1,'employee B sees only its own employee row');

SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000006',true);
SELECT is((SELECT count(*)::integer FROM public.employees WHERE id='41000000-0000-4000-8000-000000000003'),0,'inactive employee membership loses own profile access');
SELECT is((SELECT count(*)::integer FROM public.schedule_assignments WHERE employee_id='41000000-0000-4000-8000-000000000003'),0,'inactive employee membership loses schedule access');
SELECT throws_ok($$SELECT public.get_own_employee_credential_status('21000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000003')$$,'42501',NULL,'inactive membership cannot query credential status');

SELECT * FROM finish();
ROLLBACK;
