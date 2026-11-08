begin;
select plan(13);

select ok(to_regprocedure('public.create_company_for_current_owner(text,text,text)') is not null,
  'owner company creation RPC exists');
select ok((select prosecdef from pg_proc where oid='public.create_company_for_current_owner(text,text,text)'::regprocedure),
  'company creation is checked by a SECURITY DEFINER RPC');
select ok(has_function_privilege('authenticated','public.create_company_for_current_owner(text,text,text)','EXECUTE'),
  'authenticated users can request owner-checked company creation');
select ok(not has_function_privilege('anon','public.create_company_for_current_owner(text,text,text)','EXECUTE'),
  'anonymous users cannot invoke company creation');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
 ('f1100000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a@synthetic.invalid','x',now(),now(),now()),
 ('f1100000-0000-4000-8000-000000000002','authenticated','authenticated','member-b@synthetic.invalid','x',now(),now(),now());
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into public.companies(id,name) values
 ('f1100000-0000-4000-8000-000000000101','Synthetic existing owner company'),
 ('f1100000-0000-4000-8000-000000000102','Synthetic unrelated company');
insert into public.company_memberships(company_id,user_id,role,active) values
 ('f1100000-0000-4000-8000-000000000101','f1100000-0000-4000-8000-000000000001','owner',true),
 ('f1100000-0000-4000-8000-000000000102','f1100000-0000-4000-8000-000000000002','admin',true);

select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.role','',true);
set local role authenticated;
select throws_ok($$select * from public.create_company_for_current_owner('Unauthenticated',null,null)$$,
  '42501',null,'anonymous/unbound identity is denied');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1100000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f1100000-0000-4000-8000-000000000001',true);
select set_config('qr_test.created_company',
  (select company_id::text from public.create_company_for_current_owner('Synthetic second company','Synthetic legal name',null)),true);
select is((select count(*)::integer from public.company_memberships m
  where m.company_id=current_setting('qr_test.created_company')::uuid
    and m.user_id=(select auth.uid()) and m.role='owner' and m.active),1,
  'the authenticated owner receives exactly one active owner membership');
select is((select require_employee_pin from public.companies where id=current_setting('qr_test.created_company')::uuid),false,
  'new company inherits PIN disabled by default');
select ok(exists(select 1 from public.audit_log where company_id=current_setting('qr_test.created_company')::uuid
  and actor_user_id=(select auth.uid()) and entity_table='companies' and action='INSERT'),
  'company creation is recorded in the audit log');
select is((select count(*)::integer from public.companies where id='f1100000-0000-4000-8000-000000000102'),0,
  'owner cannot read an unrelated tenant through company RLS');
select throws_ok($$select * from public.create_company_for_current_owner('Bad RFC',null,'INVALID')$$,
  '22023',null,'owner cannot create a company with an invalid RFC');
select is((select count(*)::integer from public.companies where name='Bad RFC'),0,
  'invalid owner payload leaves no company row');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1100000-0000-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','f1100000-0000-4000-8000-000000000002',true);
select throws_ok($$select * from public.create_company_for_current_owner('Unauthorized company',null,null)$$,
  '42501',null,'non-owner cannot create a company');
select is((select count(*)::integer from public.companies where name='Unauthorized company'),0,
  'denied creation leaves no company row');

select * from finish();
rollback;
