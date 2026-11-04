BEGIN;
SELECT plan(27);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.supervisors'::regclass), 'supervisors has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.supervisor_branches'::regclass), 'supervisor branch assignments have RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.authorized_devices'::regclass), 'authorized devices have RLS enabled');
SELECT ok(NOT has_table_privilege('authenticated','private.device_authorization_requests','SELECT'), 'authenticated cannot directly read private device requests');
SELECT ok(has_table_privilege('authenticated','public.supervisor_branches','INSERT'), 'branch table DML grant is constrained by RLS policies');

INSERT INTO public.companies(id,name) VALUES
 ('f7000000-0000-4000-8000-000000000001','QR7 synthetic A'),
 ('f7000000-0000-4000-8000-000000000002','QR7 synthetic B');
INSERT INTO public.branches(id,company_id,name,timezone) VALUES
 ('f7100000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','QR7 A branch','America/Mexico_City'),
 ('f7100000-0000-4000-8000-000000000002','f7000000-0000-4000-8000-000000000002','QR7 B branch','America/Mexico_City');
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) VALUES
 ('f7200000-0000-4000-8000-000000000001','authenticated','authenticated','qr7-admin-a@example.invalid','','now()','now()','now()'),
 ('f7200000-0000-4000-8000-000000000002','authenticated','authenticated','qr7-admin-b@example.invalid','','now()','now()','now()'),
 ('f7200000-0000-4000-8000-000000000003','authenticated','authenticated','qr7-supervisor-a@example.invalid','','now()','now()','now()'),
 ('f7200000-0000-4000-8000-000000000004','authenticated','authenticated','qr7-inactive-admin-a@example.invalid','','now()','now()','now()'),
 ('f7200000-0000-4000-8000-000000000005','authenticated','authenticated','qr7-supervisor-b@example.invalid','','now()','now()','now()');
INSERT INTO public.company_memberships(id,company_id,user_id,role,active) VALUES
 ('f7300000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','admin',true),
 ('f7300000-0000-4000-8000-000000000002','f7000000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','admin',true),
 ('f7300000-0000-4000-8000-000000000003','f7000000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000003','supervisor',true),
 ('f7300000-0000-4000-8000-000000000004','f7000000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000004','admin',false),
 ('f7300000-0000-4000-8000-000000000005','f7000000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000005','supervisor',true);
INSERT INTO public.supervisors(company_id,membership_id) VALUES
 ('f7000000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000003'),
 ('f7000000-0000-4000-8000-000000000002','f7300000-0000-4000-8000-000000000005');
INSERT INTO public.authorized_devices(id,company_id,branch_id,membership_id,label) VALUES
 ('f7400000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000003','QR7 synthetic device A');
INSERT INTO private.device_authorization_requests(id,company_id,branch_id,membership_id,label,challenge_hash,status,reviewed_by,reviewed_at,device_id) VALUES
 ('f7500000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000003','QR7 approved request A',decode(repeat('aa',32),'hex'),'approved','f7200000-0000-4000-8000-000000000001',now(),'f7400000-0000-4000-8000-000000000001'),
 ('f7500000-0000-4000-8000-000000000002','f7000000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000002','f7300000-0000-4000-8000-000000000005','QR7 foreign pending request',decode(repeat('bb',32),'hex'),'pending',null,null,null);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f7200000-0000-4000-8000-000000000001"}',true);
SELECT set_config('qr7.branch_before_foreign',(SELECT count(*)::text FROM public.supervisor_branches WHERE company_id='f7000000-0000-4000-8000-000000000001'),true);
SELECT set_config('qr7.audit_before_foreign',(SELECT count(*)::text FROM public.audit_log WHERE company_id='f7000000-0000-4000-8000-000000000001'),true);
SELECT is((SELECT count(*)::integer FROM public.supervisors WHERE company_id='f7000000-0000-4000-8000-000000000001'),1,'admin A can read its supervisor');
SELECT is((SELECT count(*)::integer FROM public.supervisors WHERE company_id='f7000000-0000-4000-8000-000000000002'),0,'admin A cannot read company B supervisors');
SELECT is((SELECT count(*)::integer FROM public.authorized_devices WHERE company_id='f7000000-0000-4000-8000-000000000002'),0,'admin A cannot read company B devices');
SELECT is(jsonb_array_length(public.list_supervisors_and_branches('f7000000-0000-4000-8000-000000000001')->'supervisors'),1,'supervisor list RPC returns authorized company A data');
SELECT is(jsonb_array_length(public.list_supervisor_device_requests('f7000000-0000-4000-8000-000000000001')),1,'device request RPC scopes results to company A');
SELECT throws_ok($$SELECT public.list_supervisor_device_requests('f7000000-0000-4000-8000-000000000002')$$,'42501',NULL,'admin A cannot list company B device requests');
SELECT throws_ok($$SELECT public.set_supervisor_branch('f7000000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000002',true)$$,'23514',NULL,'admin A cannot assign company B supervisor or branch');
SELECT is((SELECT count(*)::integer FROM public.supervisor_branches WHERE company_id='f7000000-0000-4000-8000-000000000001'),current_setting('qr7.branch_before_foreign')::integer,'foreign assignment rejection leaves company A branch assignments unchanged');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE company_id='f7000000-0000-4000-8000-000000000001'),current_setting('qr7.audit_before_foreign')::integer,'foreign assignment rejection creates no audit event');
SELECT throws_ok($$SELECT * FROM private.device_authorization_requests$$,'42501',NULL,'authenticated cannot read private device request rows');
SELECT set_config('qr7.audit_before_assignment',current_setting('qr7.audit_before_foreign'),true);
SELECT lives_ok($$SELECT public.set_supervisor_branch('f7000000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000003','f7100000-0000-4000-8000-000000000001',true)$$,'admin A can assign an active supervisor to its branch');
SELECT is((SELECT count(*)::integer FROM public.supervisor_branches WHERE company_id='f7000000-0000-4000-8000-000000000001'),1,'authorized branch assignment persisted');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE company_id='f7000000-0000-4000-8000-000000000001'),current_setting('qr7.audit_before_assignment')::integer+1,'authorized branch assignment writes one audit event');
SELECT set_config('qr7.branch_before_role',(SELECT count(*)::text FROM public.supervisor_branches WHERE company_id='f7000000-0000-4000-8000-000000000001'),true);
SELECT set_config('qr7.audit_before_role',(SELECT count(*)::text FROM public.audit_log WHERE company_id='f7000000-0000-4000-8000-000000000001'),true);

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f7200000-0000-4000-8000-000000000003"}',true);
SELECT throws_ok($$SELECT public.set_supervisor_branch('f7000000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000003','f7100000-0000-4000-8000-000000000001',true)$$,'42501',NULL,'supervisor role cannot manage branch assignments');
SELECT throws_ok($$INSERT INTO public.supervisor_branches(company_id,membership_id,branch_id) VALUES ('f7000000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000003','f7100000-0000-4000-8000-000000000001')$$,'42501',NULL,'RLS denies direct branch assignment for supervisor role');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.supervisor_branches WHERE company_id='f7000000-0000-4000-8000-000000000001'),current_setting('qr7.branch_before_role')::integer,'rejected supervisor assignment caused no branch change');
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE company_id='f7000000-0000-4000-8000-000000000001'),current_setting('qr7.audit_before_role')::integer,'rejected supervisor assignment caused no audit event');
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f7200000-0000-4000-8000-000000000004"}',true);
SELECT is((SELECT count(*)::integer FROM public.supervisors WHERE company_id='f7000000-0000-4000-8000-000000000001'),0,'inactive admin membership cannot read supervisors');
SELECT throws_ok($$SELECT public.list_supervisors_and_branches('f7000000-0000-4000-8000-000000000001')$$,'42501',NULL,'inactive admin membership cannot use supervisor management RPC');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f7200000-0000-4000-8000-000000000001"}',true);
SELECT is(public.revoke_supervisor_device('f7000000-0000-4000-8000-000000000001','f7400000-0000-4000-8000-000000000001')->>'active','false','admin A can revoke a device in its company');
SELECT is((SELECT active FROM public.authorized_devices WHERE id='f7400000-0000-4000-8000-000000000001'),false,'device is inactive after revocation');
RESET ROLE;
SELECT is((SELECT status FROM private.device_authorization_requests WHERE id='f7500000-0000-4000-8000-000000000001'),'revoked','related request is revoked atomically');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
