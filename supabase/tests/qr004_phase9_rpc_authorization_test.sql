-- Dynamic authorization coverage for five read-oriented SECURITY DEFINER RPCs.
-- Synthetic fixtures only; RPCs run under anon/authenticated claims. This suite
-- intentionally does not call PIN verification, scanner, QR processing, or
-- attendance operations. All fixtures are rolled back.
BEGIN;
SELECT plan(62);

SELECT ok(NOT has_function_privilege('anon','public.get_company_user_invitation_for_delivery(uuid,uuid)','EXECUTE'), 'anonymous role has no EXECUTE on invitation delivery RPC');
SELECT ok(NOT has_function_privilege('anon','public.list_my_pending_company_invitations()','EXECUTE'), 'anonymous role has no EXECUTE on pending invitations RPC');
SELECT ok(NOT has_function_privilege('anon','public.get_employee_credential_status(uuid,uuid)','EXECUTE'), 'anonymous role has no EXECUTE on administrative credential status RPC');
SELECT ok(NOT has_function_privilege('anon','public.get_own_employee_credential_status(uuid,uuid)','EXECUTE'), 'anonymous role has no EXECUTE on self credential status RPC');
SELECT ok(NOT has_function_privilege('anon','public.list_authorized_supervisor_devices(uuid)','EXECUTE'), 'anonymous role has no EXECUTE on authorized device list RPC');

INSERT INTO public.companies(id,name) VALUES
 ('f9100000-0000-4000-8000-000000000001','QR9.1 synthetic company A'),
 ('f9100000-0000-4000-8000-000000000002','QR9.1 synthetic company B');
INSERT INTO public.branches(id,company_id,name,timezone) VALUES
 ('f9110000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','QR9.1 A branch 1','America/Mexico_City'),
 ('f9110000-0000-4000-8000-000000000002','f9100000-0000-4000-8000-000000000001','QR9.1 A branch 2','America/Mexico_City'),
 ('f9110000-0000-4000-8000-000000000003','f9100000-0000-4000-8000-000000000002','QR9.1 B branch 1','America/Mexico_City');

INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) VALUES
 ('f9120000-0000-4000-8000-000000000001','authenticated','authenticated','qr91-owner-a@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000002','authenticated','authenticated','qr91-admin-a@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000003','authenticated','authenticated','qr91-admin-b@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000004','authenticated','authenticated','qr91-supervisor-a@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000005','authenticated','authenticated','qr91-employee-a@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000006','authenticated','authenticated','qr91-employee-b@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000007','authenticated','authenticated','qr91-no-membership@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000008','authenticated','authenticated','qr91-inactive-admin@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000009','authenticated','authenticated','qr91-revoked-admin@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000010','authenticated','authenticated','qr91-multi-admin@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000011','authenticated','authenticated','qr91-invited-recipient@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000012','authenticated','authenticated','qr91-unconfirmed@example.invalid',NULL,NULL,'now()','now()'),
 ('f9120000-0000-4000-8000-000000000013','authenticated','authenticated','qr91-supervisor-b@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000014','authenticated','authenticated','qr91-inactive-employee@example.invalid','','now()','now()','now()'),
 ('f9120000-0000-4000-8000-000000000015','authenticated','authenticated','qr91-expired-recipient@example.invalid','','now()','now()','now()');

SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO public.company_memberships(id,company_id,user_id,role,active) VALUES
 ('f9130000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','f9120000-0000-4000-8000-000000000001','owner',true);
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',true);
INSERT INTO public.company_memberships(id,company_id,user_id,role,active) VALUES
 ('f9130000-0000-4000-8000-000000000002','f9100000-0000-4000-8000-000000000001','f9120000-0000-4000-8000-000000000002','admin',true),
 ('f9130000-0000-4000-8000-000000000003','f9100000-0000-4000-8000-000000000002','f9120000-0000-4000-8000-000000000003','admin',true),
 ('f9130000-0000-4000-8000-000000000004','f9100000-0000-4000-8000-000000000001','f9120000-0000-4000-8000-000000000004','supervisor',true),
 ('f9130000-0000-4000-8000-000000000005','f9100000-0000-4000-8000-000000000001','f9120000-0000-4000-8000-000000000005','employee',true),
 ('f9130000-0000-4000-8000-000000000006','f9100000-0000-4000-8000-000000000002','f9120000-0000-4000-8000-000000000006','employee',true),
 ('f9130000-0000-4000-8000-000000000007','f9100000-0000-4000-8000-000000000001','f9120000-0000-4000-8000-000000000008','admin',false),
 ('f9130000-0000-4000-8000-000000000008','f9100000-0000-4000-8000-000000000001','f9120000-0000-4000-8000-000000000009','admin',true),
 ('f9130000-0000-4000-8000-000000000009','f9100000-0000-4000-8000-000000000001','f9120000-0000-4000-8000-000000000010','admin',true),
 ('f9130000-0000-4000-8000-000000000010','f9100000-0000-4000-8000-000000000002','f9120000-0000-4000-8000-000000000010','admin',true),
 ('f9130000-0000-4000-8000-000000000011','f9100000-0000-4000-8000-000000000002','f9120000-0000-4000-8000-000000000013','supervisor',true),
 ('f9130000-0000-4000-8000-000000000012','f9100000-0000-4000-8000-000000000001','f9120000-0000-4000-8000-000000000014','employee',false);

INSERT INTO public.employees(id,company_id,branch_id,employee_number,first_name,last_name,auth_user_id) VALUES
 ('f9140000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','f9110000-0000-4000-8000-000000000001','QR91-A1','Synthetic','Employee A','f9120000-0000-4000-8000-000000000005'),
 ('f9140000-0000-4000-8000-000000000002','f9100000-0000-4000-8000-000000000002','f9110000-0000-4000-8000-000000000003','QR91-B1','Synthetic','Employee B','f9120000-0000-4000-8000-000000000006'),
 ('f9140000-0000-4000-8000-000000000003','f9100000-0000-4000-8000-000000000001','f9110000-0000-4000-8000-000000000002','QR91-A2','Synthetic','Unlinked',NULL),
 ('f9140000-0000-4000-8000-000000000004','f9100000-0000-4000-8000-000000000001','f9110000-0000-4000-8000-000000000001','QR91-OFF','Synthetic','Inactive','f9120000-0000-4000-8000-000000000014');
UPDATE public.employees SET active=false WHERE id='f9140000-0000-4000-8000-000000000004';
INSERT INTO public.supervisors(company_id,membership_id) VALUES
 ('f9100000-0000-4000-8000-000000000001','f9130000-0000-4000-8000-000000000004'),
 ('f9100000-0000-4000-8000-000000000002','f9130000-0000-4000-8000-000000000011');
INSERT INTO public.authorized_devices(id,company_id,branch_id,membership_id,label) VALUES
 ('f9150000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','f9110000-0000-4000-8000-000000000001','f9130000-0000-4000-8000-000000000004','QR9.1 synthetic device branch 1'),
 ('f9150000-0000-4000-8000-000000000002','f9100000-0000-4000-8000-000000000001','f9110000-0000-4000-8000-000000000002','f9130000-0000-4000-8000-000000000004','QR9.1 synthetic device branch 2'),
 ('f9150000-0000-4000-8000-000000000003','f9100000-0000-4000-8000-000000000002','f9110000-0000-4000-8000-000000000003','f9130000-0000-4000-8000-000000000011','QR9.1 synthetic device company B');

INSERT INTO public.company_user_invitations(id,company_id,email,role,invited_by,status,expires_at) VALUES
 ('f9160000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','qr91-invited-recipient@example.invalid','supervisor','f9120000-0000-4000-8000-000000000001','pending',now()+interval '1 day'),
 ('f9160000-0000-4000-8000-000000000002','f9100000-0000-4000-8000-000000000002','qr91-invited-recipient@example.invalid','employee','f9120000-0000-4000-8000-000000000003','pending',now()+interval '1 day'),
 ('f9160000-0000-4000-8000-000000000003','f9100000-0000-4000-8000-000000000001','qr91-admin-invite@example.invalid','admin','f9120000-0000-4000-8000-000000000001','pending',now()+interval '1 day'),
 ('f9160000-0000-4000-8000-000000000004','f9100000-0000-4000-8000-000000000001','qr91-expired-recipient@example.invalid','employee','f9120000-0000-4000-8000-000000000001','pending',now()-interval '1 day'),
 ('f9160000-0000-4000-8000-000000000005','f9100000-0000-4000-8000-000000000001','qr91-invited-recipient@example.invalid','employee','f9120000-0000-4000-8000-000000000001','revoked',now()+interval '1 day'),
 ('f9160000-0000-4000-8000-000000000006','f9100000-0000-4000-8000-000000000001','qr91-invited-recipient@example.invalid','employee','f9120000-0000-4000-8000-000000000001','accepted',now()+interval '1 day'),
 ('f9160000-0000-4000-8000-000000000007','f9100000-0000-4000-8000-000000000001','qr91-other-recipient@example.invalid','employee','f9120000-0000-4000-8000-000000000001','pending',now()+interval '1 day'),
 ('f9160000-0000-4000-8000-000000000008','f9100000-0000-4000-8000-000000000001','qr91-unconfirmed@example.invalid','employee','f9120000-0000-4000-8000-000000000001','pending',now()+interval '1 day');

UPDATE public.company_memberships SET active=false WHERE id='f9130000-0000-4000-8000-000000000007';
INSERT INTO public.membership_permission_overrides(company_id,membership_id,permission_code,allowed) VALUES
 ('f9100000-0000-4000-8000-000000000001','f9130000-0000-4000-8000-000000000008','company.manage',false),
 ('f9100000-0000-4000-8000-000000000001','f9130000-0000-4000-8000-000000000008','employees.manage',false),
 ('f9100000-0000-4000-8000-000000000001','f9130000-0000-4000-8000-000000000008','devices.manage',false);

SELECT set_config('request.jwt.claims','{}',true);
SELECT set_config('qr91.invitation_state',(SELECT md5(coalesce(string_agg(id::text||':'||company_id::text||':'||status||':'||expires_at::text,',' ORDER BY id),'')) FROM public.company_user_invitations),true);
SELECT set_config('qr91.audit_state',(SELECT md5(coalesce(string_agg(id::text||':'||action||':'||coalesce(entity_id::text,''),',' ORDER BY id),'')) FROM public.audit_log),true);
SELECT set_config('qr91.membership_state',(SELECT md5(coalesce(string_agg(id::text||':'||role::text||':'||active::text,',' ORDER BY id),'')) FROM public.company_memberships),true);
SELECT set_config('qr91.device_state',(SELECT md5(coalesce(string_agg(id::text||':'||company_id::text||':'||branch_id::text||':'||membership_id::text||':'||active::text||':'||coalesce(revoked_at::text,''),',' ORDER BY id),'')) FROM public.authorized_devices),true);
SELECT set_config('qr91.qr_credential_count',(SELECT count(*)::text FROM private.employee_qr_tokens),true);
SELECT set_config('qr91.pin_credential_count',(SELECT count(*)::text FROM private.employee_pin_credentials),true);

-- Invitation delivery: only active owner/admin with company.manage may view a
-- pending, unexpired invite. Admins may not read administrator invitations.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT throws_ok($$SELECT * FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000001')$$,'42501',NULL,'anonymous invitation delivery request is denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000001"}',true);
SELECT is((SELECT count(*)::integer FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000001')),1,'owner A can read its pending delivery recipient');
SELECT is((SELECT email FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000003')),'qr91-admin-invite@example.invalid','owner A may deliver an administrator invite');
SELECT is((SELECT count(*)::integer FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000004')),0,'expired invitation cannot disclose recipient data for delivery');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000002"}',true);
SELECT is((SELECT count(*)::integer FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000001')),1,'active admin A with company.manage can read its pending invitation');
SELECT is((SELECT count(*)::integer FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000003')),0,'admin A cannot read recipient details for an administrator invitation');
SELECT throws_ok($$SELECT * FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000002','f9160000-0000-4000-8000-000000000002')$$,'42501',NULL,'admin A cannot access company B invitation delivery scope');
SELECT is((SELECT count(*)::integer FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000002')),0,'foreign invitation id cannot return recipient data under company A scope');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000010"}',true);
SELECT is((SELECT count(*)::integer FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000001')),1,'multi-company admin can read delivery data in company A');
SELECT is((SELECT count(*)::integer FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000002','f9160000-0000-4000-8000-000000000002')),1,'same multi-company admin can read delivery data in company B');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000004"}',true);
SELECT throws_ok($$SELECT * FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000001')$$,'42501',NULL,'supervisor A cannot view invitation recipient details');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000005"}',true);
SELECT throws_ok($$SELECT * FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000001')$$,'42501',NULL,'employee A cannot view invitation recipient details');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000008"}',true);
SELECT throws_ok($$SELECT * FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000001')$$,'42501',NULL,'inactive admin membership cannot view invitation recipient details');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000009"}',true);
SELECT throws_ok($$SELECT * FROM public.get_company_user_invitation_for_delivery('f9100000-0000-4000-8000-000000000001','f9160000-0000-4000-8000-000000000001')$$,'42501',NULL,'revoked company.manage permission denies invitation delivery');
RESET ROLE;

-- Pending invitations are filtered by the verified database identity, not a
-- client-supplied email. A valid invitation from company B is intentional.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT throws_ok($$SELECT public.list_my_pending_company_invitations()$$,'42501',NULL,'anonymous pending invitation list request is denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000011","email":"forged@example.invalid"}',true);
SELECT is(jsonb_array_length(public.list_my_pending_company_invitations()),2,'recipient sees only its two valid pending invitations; expired, revoked and accepted rows are excluded');
SELECT ok(public.list_my_pending_company_invitations() @> '[{"companyId":"f9100000-0000-4000-8000-000000000001"}]'::jsonb
  AND public.list_my_pending_company_invitations() @> '[{"companyId":"f9100000-0000-4000-8000-000000000002"}]'::jsonb,'recipient may see valid invitations from multiple companies');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000007"}',true);
SELECT is(public.list_my_pending_company_invitations(),'[]'::jsonb,'different identity cannot see invitations addressed to another user');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000012"}',true);
SELECT is(public.list_my_pending_company_invitations(),'[]'::jsonb,'unconfirmed Auth identity receives no pending invitations');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000015"}',true);
SELECT is(public.list_my_pending_company_invitations(),'[]'::jsonb,'expired pending invitation is excluded from the matching recipient list');
RESET ROLE;

-- Administrative credential status returns booleans/status/timestamps only;
-- this suite never configures or verifies a PIN and never processes a QR.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000002"}',true);
SELECT ok(public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')->>'employeeActive'='true'
  AND public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')->>'qrStatus'='not_issued'
  AND public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')->>'pinConfigured'='false'
  AND NOT (public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001') ?| ARRAY['token','tokenHash','pinHash','secret','hash']),
  'authorized admin A receives synthetic status flags without QR or PIN secrets');
SELECT throws_ok($$SELECT public.get_employee_credential_status('f9100000-0000-4000-8000-000000000002','f9140000-0000-4000-8000-000000000002')$$,'42501',NULL,'admin A cannot query company B credential status');
SELECT throws_ok($$SELECT public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000002')$$,'P0002',NULL,'manipulated foreign employee id is not found in company A');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000004"}',true);
SELECT throws_ok($$SELECT public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')$$,'42501',NULL,'supervisor A cannot use the admin credential status RPC');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000005"}',true);
SELECT throws_ok($$SELECT public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')$$,'42501',NULL,'employee A cannot use the admin credential status RPC');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000008"}',true);
SELECT throws_ok($$SELECT public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')$$,'42501',NULL,'inactive admin membership cannot query credential status');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000009"}',true);
SELECT throws_ok($$SELECT public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')$$,'42501',NULL,'revoked employees.manage permission denies credential status');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000001"}',true);
SELECT is(public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')->>'employeeActive','true','owner A retains authorized credential status access');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000010"}',true);
SELECT is(public.get_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')->>'employeeActive','true','multi-company admin can inspect credential status in company A');
SELECT is(public.get_employee_credential_status('f9100000-0000-4000-8000-000000000002','f9140000-0000-4000-8000-000000000002')->>'employeeActive','true','same multi-company admin can inspect credential status in company B');
RESET ROLE;

-- Employee self-status is bound to both auth.uid() and the linked active
-- employee membership. No QR payload or credential hash is returned.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT throws_ok($$SELECT public.get_own_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')$$,'42501',NULL,'anonymous employee status request is denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000005"}',true);
SELECT is(public.get_own_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')->>'status','not_issued','employee A reads own synthetic credential status');
SELECT throws_ok($$SELECT public.get_own_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000003')$$,'42501',NULL,'employee cannot query an unlinked employee record');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000006"}',true);
SELECT throws_ok($$SELECT public.get_own_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')$$,'42501',NULL,'employee B cannot query employee A in another company');
SELECT throws_ok($$SELECT public.get_own_employee_credential_status('f9100000-0000-4000-8000-000000000002','f9140000-0000-4000-8000-000000000001')$$,'42501',NULL,'company identifier manipulation cannot cross-scope employee A');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000013"}',true);
SELECT throws_ok($$SELECT public.get_own_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000004')$$,'42501',NULL,'inactive employee membership and profile cannot read status');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000007"}',true);
SELECT throws_ok($$SELECT public.get_own_employee_credential_status('f9100000-0000-4000-8000-000000000001','f9140000-0000-4000-8000-000000000001')$$,'42501',NULL,'user without employee membership cannot read status');
RESET ROLE;

-- Device listing is company-scoped by devices.manage, not branch-scoped: an
-- authorized company administrator sees devices from every branch in A.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT throws_ok($$SELECT public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001')$$,'42501',NULL,'anonymous device list request is denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000001"}',true);
SELECT is(jsonb_array_length(public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001')),2,'owner A can list synthetic devices across both company A branches');
SELECT ok(public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001') @> '[{"branchId":"f9110000-0000-4000-8000-000000000002"}]'::jsonb,
  'company-scoped device manager sees a device in an unassigned second branch');
SELECT ok(NOT (public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001') @> '[{"id":"f9150000-0000-4000-8000-000000000003"}]'::jsonb),
  'company A device list excludes company B device');
SELECT ok(NOT (public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001')->0 ?| ARRAY['token','tokenHash','challenge','challengeHash','secret','hash']),
  'device RPC response contains no token or challenge material');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000002"}',true);
SELECT is(jsonb_array_length(public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001')),2,'admin A with devices.manage can list company A devices');
SELECT throws_ok($$SELECT public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000002')$$,'42501',NULL,'admin A cannot list company B devices');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000003"}',true);
SELECT is(jsonb_array_length(public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000002')),1,'admin B can list its own company device');
SELECT throws_ok($$SELECT public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001')$$,'42501',NULL,'admin B cannot list company A devices');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000010"}',true);
SELECT is(jsonb_array_length(public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001')),2,'multi-company admin can list devices in company A');
SELECT is(jsonb_array_length(public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000002')),1,'same multi-company admin can list devices in company B');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000004"}',true);
SELECT throws_ok($$SELECT public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001')$$,'42501',NULL,'supervisor without devices.manage cannot list devices');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000008"}',true);
SELECT throws_ok($$SELECT public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001')$$,'42501',NULL,'inactive admin membership cannot list devices');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"f9120000-0000-4000-8000-000000000009"}',true);
SELECT throws_ok($$SELECT public.list_authorized_supervisor_devices('f9100000-0000-4000-8000-000000000001')$$,'42501',NULL,'revoked devices.manage permission denies device listing');
RESET ROLE;

SELECT is((SELECT md5(coalesce(string_agg(id::text||':'||company_id::text||':'||status||':'||expires_at::text,',' ORDER BY id),'')) FROM public.company_user_invitations),current_setting('qr91.invitation_state'),'read RPCs caused no invitation state changes');
SELECT is((SELECT md5(coalesce(string_agg(id::text||':'||action||':'||coalesce(entity_id::text,''),',' ORDER BY id),'')) FROM public.audit_log),current_setting('qr91.audit_state'),'read RPCs caused no audit side effects');
SELECT is((SELECT md5(coalesce(string_agg(id::text||':'||role::text||':'||active::text,',' ORDER BY id),'')) FROM public.company_memberships),current_setting('qr91.membership_state'),'read RPCs caused no membership state changes');
SELECT is((SELECT md5(coalesce(string_agg(id::text||':'||company_id::text||':'||branch_id::text||':'||membership_id::text||':'||active::text||':'||coalesce(revoked_at::text,''),',' ORDER BY id),'')) FROM public.authorized_devices),current_setting('qr91.device_state'),'read RPCs caused no device state changes');
SELECT is((SELECT count(*)::integer FROM private.employee_qr_tokens),(current_setting('qr91.qr_credential_count'))::integer,'read RPCs caused no QR credential changes');
SELECT is((SELECT count(*)::integer FROM private.employee_pin_credentials),(current_setting('qr91.pin_credential_count'))::integer,'read RPCs caused no PIN credential changes or attempts');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
