begin;
select plan(21);

select ok(to_regprocedure('public.create_first_company_for_current_user(text,text,text)') is not null,
  'legacy first-company signature remains present as a rejecting shim');
select ok(to_regprocedure('public.create_first_company_for_current_user(text,text,text,text,text)') is not null,
  'complete first-company registration RPC exists');
select ok((select prosecdef from pg_proc where oid='public.create_first_company_for_current_user(text,text,text,text,text)'::regprocedure),
  'first-company creation is atomic inside a SECURITY DEFINER function');
select ok(has_function_privilege('authenticated','public.create_first_company_for_current_user(text,text,text,text,text)','EXECUTE'),
  'authenticated identities may invoke first-company creation');
select ok(not has_function_privilege('anon','public.create_first_company_for_current_user(text,text,text,text,text)','EXECUTE'),
  'anonymous identities cannot invoke first-company creation');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
 ('f2100000-0000-4000-8000-000000000001','authenticated','authenticated','first-owner@synthetic.invalid','x',now(),now(),now()),
 ('f2100000-0000-4000-8000-000000000002','authenticated','authenticated','tenant-b-admin@synthetic.invalid','x',now(),now(),now()),
 ('f2100000-0000-4000-8000-000000000003','authenticated','authenticated','unconfirmed-owner@synthetic.invalid','x',null,now(),now());
insert into public.companies(id,name) values ('f2100000-0000-4000-8000-000000000102','Synthetic company B');
insert into public.company_memberships(company_id,user_id,role,active)
 values('f2100000-0000-4000-8000-000000000102','f2100000-0000-4000-8000-000000000002','admin',true);

select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok($$select * from public.create_first_company_for_current_user('Unauthenticated',null,null)$$,
  '42501',null,'missing authenticated identity is rejected');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"f2100000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','f2100000-0000-4000-8000-000000000001',true);
select set_config('qr_test.first_company',
  (select company_id::text from public.create_first_company_for_current_user('Synthetic first company','Synthetic legal name','SYN010101ABC','123 QA Street','RP-QA-001')),true);
select is((select count(*)::integer from public.companies where id=current_setting('qr_test.first_company')::uuid),1,
  'confirmed authenticated user creates one company');
select is((select count(*)::integer from public.company_memberships m
  where m.company_id=current_setting('qr_test.first_company')::uuid and m.user_id=(select auth.uid())
    and m.role='owner' and m.active),1,'the Auth identity receives exactly one active Owner membership');
select ok(exists(select 1 from public.audit_log where company_id=current_setting('qr_test.first_company')::uuid
  and actor_user_id=(select auth.uid()) and entity_table='companies' and action='INSERT'),
  'company creation is audited with the authenticated actor');
select is((select require_employee_pin from public.companies where id=current_setting('qr_test.first_company')::uuid),false,
  'first company retains the default optional PIN policy');
select is((select company_id::text from public.create_first_company_for_current_user('Synthetic first company','Synthetic legal name','SYN010101ABC','123 QA Street','RP-QA-001')),
  current_setting('qr_test.first_company'),'retry returns the same company');
select is((select count(*)::integer from public.company_memberships where user_id=(select auth.uid())),1,
  'retry does not create another company membership');
select throws_ok($$select public.create_first_company_for_current_user('Wrong signature',null,null,'f2100000-0000-4000-8000-000000000002')$$,
  '42883',null,'client cannot pass an arbitrary Owner user_id');
select is((select count(*)::integer from public.companies where id='f2100000-0000-4000-8000-000000000102'),0,
  'the new Owner cannot read the unrelated tenant through company RLS');
select throws_ok($$select * from public.create_first_company_for_current_user('Bad RFC',null,'INVALID','123 QA Street','RP-QA-002')$$,
  '22023',null,'invalid company details are rejected');
reset role;
select is((select count(*)::integer from public.companies where name='Bad RFC'),0,
  'invalid company details leave no company row');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"f2100000-0000-4000-8000-000000000003"}',true);
select set_config('request.jwt.claim.sub','f2100000-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok($$select * from public.create_first_company_for_current_user('Unconfirmed company',null,'UNC010101ABC','123 QA Street','RP-QA-003')$$,
  '42501',null,'unconfirmed Auth identity cannot create a company');
reset role;
select is((select count(*)::integer from public.companies where name='Unconfirmed company'),0,
  'unconfirmed identity leaves no company row');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"f2100000-0000-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','f2100000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select * from public.create_first_company_for_current_user('Tenant B duplicate',null,'TEN010101ABC','123 QA Street','RP-QA-004')$$,
  '42501',null,'an existing tenant member cannot use first-company registration');
reset role;
select is((select count(*)::integer from public.companies where name='Tenant B duplicate'),0,
  'existing tenant member denial creates no additional company');
set local role authenticated;
select is((select count(*)::integer from public.companies where id=current_setting('qr_test.first_company')::uuid),0,
  'an administrator in tenant B cannot read the Owner company created in tenant A');

select * from finish();
rollback;
