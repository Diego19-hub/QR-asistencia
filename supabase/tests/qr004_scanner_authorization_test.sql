-- Synthetic, transactional QR/device authorization checks for QR-004.
-- Run only with the isolated local Supabase matrix runner.
BEGIN;
SELECT plan(15);

SELECT has_table('private','device_authorization_requests','device enrollment requests stay in the private schema');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='private.device_authorization_requests'::regclass),'device enrollment requests require RLS');
SELECT ok(NOT has_table_privilege('authenticated','private.device_authorization_requests','SELECT')
  AND NOT has_table_privilege('service_role','private.device_authorization_requests','SELECT'),
  'API roles cannot read device challenge hashes or request rows directly');
SELECT ok(has_function_privilege('authenticated','public.request_supervisor_device(uuid,uuid,text,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.review_supervisor_device_request(uuid,uuid,boolean)','EXECUTE')
  AND has_function_privilege('authenticated','public.redeem_supervisor_device(uuid,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.revoke_supervisor_device(uuid,uuid)','EXECUTE'),
  'authenticated device lifecycle is exposed only through checked RPCs');
SELECT ok(NOT has_function_privilege('anon','public.request_supervisor_device(uuid,uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.review_supervisor_device_request(uuid,uuid,boolean)','EXECUTE')
  AND NOT has_function_privilege('anon','public.redeem_supervisor_device(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.revoke_supervisor_device(uuid,uuid)','EXECUTE'),
  'anonymous role cannot invoke device lifecycle RPCs');

INSERT INTO public.companies(id,name) VALUES
 ('a2000000-0000-4000-8000-000000000001','QR004 synthetic A'),
 ('a2000000-0000-4000-8000-000000000002','QR004 synthetic B');
INSERT INTO public.branches(id,company_id,name,timezone) VALUES
 ('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','A branch one','America/Mexico_City'),
 ('a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','A branch two','America/Mexico_City'),
 ('a3000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000002','B branch one','America/Mexico_City');
INSERT INTO public.employees(id,company_id,branch_id,employee_number,first_name,last_name) VALUES
 ('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','QR004-A1','Synthetic','A1'),
 ('a4000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002','QR004-A2','Synthetic','A2'),
 ('a4000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000003','QR004-B1','Synthetic','B1');
INSERT INTO private.employee_pin_credentials(company_id,employee_id,pin_hash) VALUES
 ('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',extensions.crypt('123456',extensions.gen_salt('bf',4))),
 ('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002',extensions.crypt('123456',extensions.gen_salt('bf',4))),
 ('a2000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000003',extensions.crypt('123456',extensions.gen_salt('bf',4)));
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) VALUES
 ('a5000000-0000-4000-8000-000000000001','authenticated','authenticated','qr004-supervisor@example.invalid','','now()','now()','now()');
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO public.company_memberships(id,company_id,user_id,role,active) VALUES
 ('a6000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','supervisor',true);
RESET ROLE;
INSERT INTO public.supervisors(company_id,membership_id) VALUES
 ('a2000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001');
INSERT INTO public.supervisor_branches(company_id,membership_id,branch_id) VALUES
 ('a2000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001');
INSERT INTO public.authorized_devices(id,company_id,branch_id,membership_id,label) VALUES
 ('a7000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','QR004 synthetic scanner');
INSERT INTO private.device_token_hashes(device_id,token_hash) VALUES
 ('a7000000-0000-4000-8000-000000000001',extensions.digest(convert_to('qr004-device-token-synthetic-A1','UTF8'),'sha256'));
INSERT INTO private.employee_qr_tokens(employee_id,token_hash) VALUES
 ('a4000000-0000-4000-8000-000000000001',extensions.digest(convert_to('qr004-employee-qr-synthetic-A1','UTF8'),'sha256')),
 ('a4000000-0000-4000-8000-000000000002',extensions.digest(convert_to('qr004-employee-qr-synthetic-A2','UTF8'),'sha256')),
 ('a4000000-0000-4000-8000-000000000003',extensions.digest(convert_to('qr004-employee-qr-synthetic-B1','UTF8'),'sha256'));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a5000000-0000-4000-8000-000000000001"}',true);
SELECT is(public.scan_employee_attendance('a2000000-0000-4000-8000-000000000001','qr004-employee-qr-synthetic-A1','123456','qr004-device-token-synthetic-A1')->>'employeeId','a4000000-0000-4000-8000-000000000001','authorized supervisor and device can scan within assigned branch');
SELECT throws_ok($$SELECT public.scan_employee_attendance('a2000000-0000-4000-8000-000000000001','qr004-employee-qr-synthetic-A2','123456','qr004-device-token-synthetic-A1')$$,'42501',NULL,'scanner cannot access another branch in the same company');
SELECT throws_ok($$SELECT public.scan_employee_attendance('a2000000-0000-4000-8000-000000000002','qr004-employee-qr-synthetic-B1','123456','qr004-device-token-synthetic-A1')$$,'42501',NULL,'scanner cannot change tenant using a foreign company ID');
SELECT throws_ok($$SELECT public.scan_employee_attendance('a2000000-0000-4000-8000-000000000001','qr004-employee-qr-synthetic-A1','123456','unknown-synthetic-device')$$,'42501',NULL,'direct scanner RPC rejects an unknown device');
RESET ROLE;
UPDATE private.employee_qr_tokens SET revoked_at=clock_timestamp() WHERE employee_id='a4000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.scan_employee_attendance('a2000000-0000-4000-8000-000000000001','qr004-employee-qr-synthetic-A1','123456','qr004-device-token-synthetic-A1')$$,'P0002',NULL,'direct scanner RPC rejects a revoked QR credential');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.attendance_events WHERE company_id IN ('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002')),0,'read scans and rejected RPC calls create no attendance events');
SELECT is((SELECT count(*)::integer FROM public.attendance_sessions WHERE company_id IN ('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002')),0,'read scans and rejected RPC calls create no sessions');
SELECT is((SELECT sum(failed_attempts)::integer FROM private.employee_pin_credentials),0,'authorization denials never invoke incorrect PIN attempts');
SELECT ok(NOT has_function_privilege('anon','public.scan_employee_attendance(uuid,text,text,text)','EXECUTE'),'anonymous role cannot invoke the privileged scanner RPC');
SELECT ok(NOT has_table_privilege('authenticated','private.device_token_hashes','SELECT') AND NOT has_table_privilege('authenticated','private.employee_qr_tokens','SELECT'),'authenticated role cannot read device or QR token hashes');

SELECT * FROM finish();
ROLLBACK;
