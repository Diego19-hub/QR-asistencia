-- Transactional PIN lockout regression tests. Run only in local disposable Supabase.
BEGIN;
SELECT plan(35);

INSERT INTO public.companies(id,name) VALUES
 ('92000000-0000-4000-8000-000000000001','PIN lockout synthetic A'),
 ('92000000-0000-4000-8000-000000000002','PIN lockout synthetic B');
INSERT INTO public.branches(id,company_id,name,timezone) VALUES
 ('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','PIN branch A','America/Mexico_City'),
 ('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','PIN branch B','America/Mexico_City');
INSERT INTO public.employees(id,company_id,branch_id,employee_number,first_name,last_name) VALUES
 ('94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','PIN-A','Prueba','A'),
 ('94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000002','PIN-B','Prueba','B');
INSERT INTO private.employee_pin_credentials(company_id,employee_id,pin_hash)
VALUES ('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',extensions.crypt('123456',extensions.gen_salt('bf',4))),
       ('92000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000002',extensions.crypt('123456',extensions.gen_salt('bf',4)));
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
VALUES ('95000000-0000-4000-8000-000000000001','authenticated','authenticated','pin-lockout-supervisor@example.invalid','','now()','now()','now()');
INSERT INTO public.company_memberships(id,company_id,user_id,role,active)
VALUES ('96000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','supervisor',true);
INSERT INTO public.supervisors(company_id,membership_id)
VALUES ('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001');
INSERT INTO public.supervisor_branches(company_id,membership_id,branch_id)
VALUES ('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001');
INSERT INTO public.authorized_devices(id,company_id,branch_id,membership_id,label)
VALUES ('97000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','PIN lockout disposable device');
INSERT INTO private.device_token_hashes(device_id,token_hash)
VALUES ('97000000-0000-4000-8000-000000000001',extensions.digest(convert_to('pin-lockout-device-token-disposable-00000000000001','UTF8'),'sha256'));
INSERT INTO private.employee_qr_tokens(employee_id,token_hash)
VALUES ('94000000-0000-4000-8000-000000000001',extensions.digest(convert_to('pin-lockout-qr-token-disposable-00000000000000001','UTF8'),'sha256'));

SELECT is(private.verify_employee_pin('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','000000')->>'status','invalid','first incorrect PIN is rejected');
SELECT is((SELECT failed_attempts::integer FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000001'),1,'first failed attempt persisted');
SELECT private.verify_employee_pin('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','000000');
SELECT private.verify_employee_pin('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','000000');
SELECT private.verify_employee_pin('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','000000');
SELECT is((SELECT failed_attempts::integer FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000001'),4,'four consecutive failures persisted');
SELECT is(private.verify_employee_pin('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','000000')->>'status','locked','fifth failed attempt activates lockout');
SELECT is((SELECT failed_attempts::integer FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000001'),5,'fifth attempt is persisted at the cap');
SELECT ok((SELECT locked_until > clock_timestamp() AND locked_until <= clock_timestamp()+interval '15 minutes' FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000001'),'lockout expires in 15 minutes');
SELECT is(private.verify_employee_pin('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','000000')->>'status','locked','sixth failed attempt is rejected during lockout');
SELECT is(private.verify_employee_pin('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','123456')->>'status','locked','correct PIN is rejected during lockout');
SELECT is((SELECT failed_attempts::integer FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000001'),5,'attempts during lockout do not change the capped counter');
UPDATE private.employee_pin_credentials SET locked_until=clock_timestamp()-interval '1 second' WHERE employee_id='94000000-0000-4000-8000-000000000001';
SELECT is(private.verify_employee_pin('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','000000')->>'status','invalid','incorrect PIN is counted again after expiration');
SELECT is((SELECT failed_attempts::integer FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000001'),1,'expired lockout starts a new attempt window');
SELECT is(private.verify_employee_pin('92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','123456')->>'status','valid','correct PIN succeeds after expiration');
SELECT is((SELECT failed_attempts::integer FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000001'),0,'successful verification resets counter');
SELECT is((SELECT failed_attempts::integer FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000002'),0,'other company credential remains isolated');
SELECT is(private.verify_employee_pin('92000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','000000')->>'status','unavailable','cross-company employee lookup is rejected');
SELECT is((SELECT failed_attempts::integer FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000002'),0,'cross-company attempt does not change another tenant counter');
SELECT ok(position('return jsonb_build_object(''pinError'',case' in pg_get_functiondef('public.scan_employee_attendance(uuid,text,text,text)'::regprocedure)) > 0,'preview returns a structured PIN rejection');
SELECT ok(position('return jsonb_build_object(''pinError'',case' in pg_get_functiondef('public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid)'::regprocedure)) > 0,'confirmation returns a structured PIN rejection');
SELECT ok(position('raise exception ''pin invalid''' in pg_get_functiondef('public.scan_employee_attendance(uuid,text,text,text)'::regprocedure)) = 0,'preview does not abort after counting a failed PIN');
SELECT ok(position('raise exception ''pin invalid''' in pg_get_functiondef('public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid)'::regprocedure)) = 0,'confirmation does not abort after counting a failed PIN');
SELECT ok(position('return jsonb_build_object(''pinError'',case' in pg_get_functiondef('public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid)'::regprocedure)) < position('private.record_attendance_event' in pg_get_functiondef('public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid)'::regprocedure)),'PIN rejection returns before any attendance event is recorded');
SELECT ok(NOT has_function_privilege('authenticated','private.verify_employee_pin(uuid,uuid,text)','EXECUTE'),'authenticated users cannot call the private verifier');
SELECT ok(position('for update' in pg_get_functiondef('private.verify_employee_pin(uuid,uuid,text)'::regprocedure)) > 0,'PIN verification serializes concurrent attempts by locking the credential row');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000001"}',true);
SELECT is(public.scan_employee_attendance('92000000-0000-4000-8000-000000000001','pin-lockout-qr-token-disposable-00000000000000001','000000','pin-lockout-device-token-disposable-00000000000001')->>'pinError','pin_invalid','preview reports an invalid PIN through the structured result');
RESET ROLE;
SELECT is((SELECT failed_attempts::integer FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000001'),1,'preview commits its failed PIN attempt');
SET LOCAL ROLE authenticated;
SELECT is(public.confirm_employee_attendance('92000000-0000-4000-8000-000000000001','pin-lockout-qr-token-disposable-00000000000000001','000000','pin-lockout-device-token-disposable-00000000000001','clock_in','98000000-0000-4000-8000-000000000001',null)->>'pinError','pin_invalid','confirmation reports an invalid PIN through the structured result');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.attendance_events WHERE company_id='92000000-0000-4000-8000-000000000001'),0,'invalid PIN confirmation writes no attendance event');
SET LOCAL ROLE authenticated;
SELECT is(public.scan_employee_attendance('92000000-0000-4000-8000-000000000001','pin-lockout-qr-token-disposable-00000000000000001','000000','pin-lockout-device-token-disposable-00000000000001')->>'pinError','pin_invalid','third invalid PIN remains rejected through preview');
SELECT is(public.confirm_employee_attendance('92000000-0000-4000-8000-000000000001','pin-lockout-qr-token-disposable-00000000000000001','000000','pin-lockout-device-token-disposable-00000000000001','clock_in','98000000-0000-4000-8000-000000000002',null)->>'pinError','pin_invalid','fourth invalid PIN remains rejected through confirmation');
SELECT is(public.confirm_employee_attendance('92000000-0000-4000-8000-000000000001','pin-lockout-qr-token-disposable-00000000000000001','000000','pin-lockout-device-token-disposable-00000000000001','clock_in','98000000-0000-4000-8000-000000000003',null)->>'pinError','pin_locked','fifth invalid PIN activates lockout through confirmation');
SELECT is(public.scan_employee_attendance('92000000-0000-4000-8000-000000000001','pin-lockout-qr-token-disposable-00000000000000001','123456','pin-lockout-device-token-disposable-00000000000001')->>'pinError','pin_locked','correct PIN remains rejected during scanner lockout');
RESET ROLE;
SELECT is((SELECT failed_attempts::integer FROM private.employee_pin_credentials WHERE employee_id='94000000-0000-4000-8000-000000000001'),5,'scanner RPC lockout counter persists at five');
SELECT is((SELECT count(*)::integer FROM public.attendance_sessions WHERE company_id='92000000-0000-4000-8000-000000000001'),0,'invalid or blocked PIN creates no attendance session');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.scan_employee_attendance('92000000-0000-4000-8000-000000000001','pin-lockout-qr-token-disposable-00000000000000001','000000','unauthorized-device-token')$$,'42501',NULL,'unauthorized device cannot preview attendance');
RESET ROLE;
UPDATE private.employee_qr_tokens SET revoked_at=clock_timestamp() WHERE employee_id='94000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.scan_employee_attendance('92000000-0000-4000-8000-000000000001','pin-lockout-qr-token-disposable-00000000000000001','000000','pin-lockout-device-token-disposable-00000000000001')$$,'P0002',NULL,'revoked QR cannot preview attendance');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
