begin;
select plan(40);

select ok(to_regprocedure('public.get_company_sensitive_profile(uuid)') is not null, 'company sensitive profile RPC exists');
select ok(to_regprocedure('public.get_employee_sensitive_profile(uuid,uuid)') is not null, 'employee sensitive profile RPC exists');
select ok(has_function_privilege('authenticated','public.get_employee_sensitive_profile(uuid,uuid)','EXECUTE'), 'authenticated API calls are checked by the RPC');
select ok(not has_function_privilege('anon','public.get_employee_sensitive_profile(uuid,uuid)','EXECUTE'), 'anonymous users cannot read sensitive employee data');
select ok(not has_table_privilege('authenticated','private.employee_sensitive_data','SELECT'), 'authenticated users cannot read the private PII table directly');
select ok(not has_column_privilege('authenticated','public.companies','rfc','SELECT'), 'ordinary company reads cannot select public RFC column');
select ok(not has_column_privilege('authenticated','public.companies','rfc','UPDATE'), 'ordinary company updates cannot write public RFC column');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
 ('e1100000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a@synthetic.invalid','x',now(),now(),now()),
 ('e1100000-0000-4000-8000-000000000002','authenticated','authenticated','owner-b@synthetic.invalid','x',now(),now(),now()),
 ('e1100000-0000-4000-8000-000000000003','authenticated','authenticated','supervisor-a@synthetic.invalid','x',now(),now(),now());
insert into public.companies(id,name,legal_name) values
 ('e1200000-0000-4000-8000-000000000001','Synthetic Sensitive A','QA legal name - Synthetic Sensitive A'),
 ('e1200000-0000-4000-8000-000000000002','Synthetic Sensitive B','QA legal name - Synthetic Sensitive B');
insert into private.company_sensitive_data(company_id,address,rfc,employer_registration_number) values
 ('e1200000-0000-4000-8000-000000000001','QA address A','SYN010101ABC','RP-A'),
 ('e1200000-0000-4000-8000-000000000002','QA address B','TST010101XYZ','RP-B');
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
insert into public.company_memberships(company_id,user_id,role,active) values
 ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','owner',true),
 ('e1200000-0000-4000-8000-000000000002','e1100000-0000-4000-8000-000000000002','owner',true),
 ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000003','supervisor',true);
reset role;
insert into public.employees(id,company_id,employee_number,first_name,last_name) values
 ('e1300000-0000-4000-8000-000000000001','e1200000-0000-4000-8000-000000000001','SENSITIVE-001','QA','Worker'),
 ('e1300000-0000-4000-8000-000000000002','e1200000-0000-4000-8000-000000000001','LEGACY-NO-RFC','QA','Legacy');
insert into private.employee_sensitive_data(company_id,employee_id,nss,personal_rfc) values
 ('e1200000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','12345678901','ABCD010101ABC');
insert into private.employee_sensitive_data(company_id,employee_id,nss,personal_rfc) values
 ('e1200000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000002','12345678902',null);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1100000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select rfc from public.get_company_sensitive_profile('e1200000-0000-4000-8000-000000000001')),'SYN010101ABC','authorized owner reads only their company sensitive profile');
select throws_ok($$select * from public.get_company_sensitive_profile('e1200000-0000-4000-8000-000000000002')$$,'42501',null,'owner cannot read another company profile');
select is((select address from public.update_company_settings('e1200000-0000-4000-8000-000000000001',
  '{"name":"Synthetic Sensitive A Updated","legalName":"Updated synthetic legal name","address":"Updated QA address A","rfc":"SYN010101ABC","employerRegistrationNumber":"RP-A"}'::jsonb,null)),'Updated QA address A',
  'authorized owner can update required company profile fields');
select is((select legal_name from public.companies where id='e1200000-0000-4000-8000-000000000001'),
  'Updated synthetic legal name','authorized company profile update persists the legal name');
select throws_ok($$select * from public.update_company_settings('e1200000-0000-4000-8000-000000000001',
  '{"name":"Should not save","legalName":"   ","address":"Updated QA address A","rfc":"SYN010101ABC","employerRegistrationNumber":"RP-A"}'::jsonb,null)$$,
  '23514',null,'company profile RPC rejects a whitespace-only legal name');
select is((select name from public.companies where id='e1200000-0000-4000-8000-000000000001'),
  'Synthetic Sensitive A Updated','rejected blank legal name preserves the prior company profile');
select throws_ok($$select * from public.update_company_settings('e1200000-0000-4000-8000-000000000002',
  '{"name":"Unauthorized","legalName":null,"address":"Unauthorized","rfc":"TST010101XYZ","employerRegistrationNumber":"RP-B"}'::jsonb,null)$$,'42501',null,
  'owner cannot update another company profile');
select is((select nss from public.get_employee_sensitive_profile('e1200000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001')),'12345678901','authorized owner can retrieve scoped employee sensitive fields');
select throws_ok($$select * from public.get_employee_sensitive_profile('e1200000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001')$$,'42501',null,'owner cannot read another company employee PII');
select throws_ok($$select nss from private.employee_sensitive_data$$,'42501',null,'direct Data API access to sensitive storage is denied');
select ok(set_config('qr_test.created_employee',public.create_employee_with_sensitive_data('e1200000-0000-4000-8000-000000000001','{"employee_number":"SENSITIVE-CREATED","first_name":"QA","last_name":"Created","nss":"98765432101","personal_rfc":"wxyz010101abc"}'::jsonb)::text,true) <> '', 'authorized Owner can create employee and private sensitive data atomically');
select is((select personal_rfc from public.get_employee_sensitive_profile('e1200000-0000-4000-8000-000000000001',current_setting('qr_test.created_employee')::uuid)),'WXYZ010101ABC','creation normalizes a valid RFC to uppercase');
select throws_ok($$select public.create_employee_with_sensitive_data('e1200000-0000-4000-8000-000000000001','{"employee_number":"INVALID-NSS","first_name":"QA","last_name":"Invalid","nss":"123","personal_rfc":"BAD"}'::jsonb)$$,'22023',null,'invalid worker NSS and RFC are rejected');
select throws_ok($$select public.create_employee_with_sensitive_data('e1200000-0000-4000-8000-000000000001','{"employee_number":"MISSING-RFC","first_name":"QA","last_name":"Missing","nss":"98765432102"}'::jsonb)$$,'22023',null,'employee creation rejects a missing RFC');
select throws_ok($$select public.create_employee_with_sensitive_data('e1200000-0000-4000-8000-000000000001','{"employee_number":"BLANK-RFC","first_name":"QA","last_name":"Blank","nss":"98765432103","personal_rfc":"   "}'::jsonb)$$,'22023',null,'employee creation rejects a blank RFC');
select throws_ok($$select public.create_employee_with_sensitive_data('e1200000-0000-4000-8000-000000000001','{"employee_number":"BAD-RFC","first_name":"QA","last_name":"Invalid","nss":"98765432104","personal_rfc":"INVALID"}'::jsonb)$$,'22023',null,'employee creation rejects an invalid RFC format');
select throws_ok($$select public.create_employee_with_sensitive_data('e1200000-0000-4000-8000-000000000001','{"employee_number":"BAD-RFC-FORMAT","first_name":"QA","last_name":"Invalid","nss":"98765432105","personal_rfc":"INVALID"}'::jsonb)$$,'22023',null,'employee creation rejects an invalid RFC independently of a valid NSS');
select is((select count(*)::integer from public.employees where employee_number in ('MISSING-RFC','BLANK-RFC','BAD-RFC','BAD-RFC-FORMAT')),0,
  'rejected RFC creates leave no employee rows');
select is(public.update_employee_with_sensitive_data('e1200000-0000-4000-8000-000000000001',current_setting('qr_test.created_employee')::uuid,
  '{"nss":"87654321098","personal_rfc":"ijkl010101abc"}'::jsonb)::text,current_setting('qr_test.created_employee'),
  'authorized owner can update sensitive employee data');
select is((select nss from public.get_employee_sensitive_profile('e1200000-0000-4000-8000-000000000001',current_setting('qr_test.created_employee')::uuid)),'87654321098',
  'updated employee NSS is normalized and returned through the protected RPC');
select is((select personal_rfc from public.get_employee_sensitive_profile('e1200000-0000-4000-8000-000000000001',current_setting('qr_test.created_employee')::uuid)),'IJKL010101ABC',
  'valid RFC updates are normalized and returned through the protected RPC');
select throws_ok($$select public.update_employee_with_sensitive_data('e1200000-0000-4000-8000-000000000001',current_setting('qr_test.created_employee')::uuid,'{"personal_rfc":"   "}'::jsonb)$$,
  '22023',null,'employee update rejects an empty RFC');
select is((select personal_rfc from public.get_employee_sensitive_profile('e1200000-0000-4000-8000-000000000001',current_setting('qr_test.created_employee')::uuid)),'IJKL010101ABC',
  'rejected empty RFC update leaves the prior RFC unchanged');
select is((select personal_rfc from public.get_employee_sensitive_profile('e1200000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000002')),null,
  'legacy employee with missing RFC remains readable');
select throws_ok($$select public.update_employee_with_sensitive_data('e1200000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000002','{"active":false}'::jsonb)$$,
  '22023',null,'saving a legacy record requires completing its RFC');
select ok((select active from public.employees where id='e1300000-0000-4000-8000-000000000002'),
  'rejected legacy save does not change employee status');
select is(public.update_employee_with_sensitive_data('e1200000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000002',
  '{"nss":"87654321097","personal_rfc":"mnop010203xyz"}'::jsonb)::text,'e1300000-0000-4000-8000-000000000002',
  'authorized Owner can complete the RFC on a legacy record');
select is((select personal_rfc from public.get_employee_sensitive_profile('e1200000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000002')),'MNOP010203XYZ',
  'completed legacy RFC is persisted in normalized form');
reset role;
select is((select d.nss from private.employee_sensitive_data d where d.employee_id=current_setting('qr_test.created_employee')::uuid),'87654321098','authorized creation and update persist the employee NSS');
select ok(not exists(select 1 from public.audit_log a where a.entity_id=current_setting('qr_test.created_employee')::uuid
  and (coalesce(a.before_data::text,'') like '%98765432101%' or coalesce(a.after_data::text,'') like '%98765432101%'
    or coalesce(a.before_data::text,'') like '%WXYZ010101ABC%' or coalesce(a.after_data::text,'') like '%WXYZ010101ABC%'
    or coalesce(a.before_data::text,'') like '%87654321098%' or coalesce(a.after_data::text,'') like '%87654321098%'
    or coalesce(a.before_data::text,'') like '%IJKL010101ABC%' or coalesce(a.after_data::text,'') like '%IJKL010101ABC%')),
  'sensitive values are excluded from employee audit logs');
select is((select count(*)::integer from public.employees where employee_number='INVALID-NSS'),0,'rejected validation leaves no employee row');
select throws_ok($$insert into private.company_sensitive_data(company_id,rfc) values('e1200000-0000-4000-8000-000000000002','SYN010101ABC')$$,'23505',null,'company RFC uniqueness remains enforced in private storage');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1100000-0000-4000-8000-000000000003"}',true);
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
select throws_ok($$select * from public.get_employee_sensitive_profile('e1200000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001')$$,'42501',null,'supervisor role cannot read sensitive employee fields');

select * from finish();
rollback;
