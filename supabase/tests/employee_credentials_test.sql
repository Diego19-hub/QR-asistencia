BEGIN;
SELECT plan(13);

SELECT has_table('private', 'employee_pin_credentials', 'employee PIN hashes stay in the private schema');
SELECT has_column('private', 'employee_pin_credentials', 'pin_hash', 'PIN credentials persist only the hash field');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='private.employee_qr_tokens'::regclass), 'QR token storage requires RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='private.employee_pin_credentials'::regclass), 'PIN storage requires RLS');
SELECT ok(NOT has_table_privilege('authenticated','private.employee_qr_tokens','SELECT'), 'authenticated users cannot read QR hashes directly');
SELECT ok(NOT has_table_privilege('service_role','private.employee_qr_tokens','SELECT'), 'service role has no direct QR hash table grant');
SELECT ok(NOT has_table_privilege('authenticated','private.employee_pin_credentials','SELECT'), 'authenticated users cannot read PIN hashes directly');
SELECT ok(has_function_privilege('authenticated','public.get_employee_credential_status(uuid,uuid)','EXECUTE'), 'credential status is available through the authorized RPC');
SELECT ok(has_function_privilege('authenticated','public.issue_employee_qr_token(uuid,uuid,text,boolean)','EXECUTE'), 'QR issue and regeneration are available through the authorized RPC');
SELECT ok(has_function_privilege('authenticated','public.revoke_employee_qr_token(uuid,uuid)','EXECUTE'), 'QR revocation is available through the authorized RPC');
SELECT ok(has_function_privilege('authenticated','public.set_employee_pin(uuid,uuid,text)','EXECUTE'), 'PIN setup is available through the authorized RPC');
SELECT ok(NOT has_function_privilege('authenticated','private.verify_employee_pin(uuid,uuid,text)','EXECUTE'), 'PIN verification is not exposed to the browser in this stage');
SELECT ok(position('extensions.crypt(p_pin,extensions.gen_salt' in pg_get_functiondef('public.set_employee_pin(uuid,uuid,text)'::regprocedure)) > 0
          AND position('interval ''15 minutes''' in pg_get_functiondef('private.verify_employee_pin(uuid,uuid,text)'::regprocedure)) > 0,
          'PIN is bcrypt hashed and internal verification implements a timed lockout');

SELECT * FROM finish();
ROLLBACK;
