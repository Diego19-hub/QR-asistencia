-- Transactional synthetic test for invitation acceptance and tenant boundaries.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
 ('81000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a@example.invalid','','now()','now()','now()'),
 ('81000000-0000-4000-8000-000000000002','authenticated','authenticated','admin-a@example.invalid','','now()','now()','now()'),
 ('81000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b@example.invalid','','now()','now()','now()'),
 ('81000000-0000-4000-8000-000000000004','authenticated','authenticated','supervisor-new@example.invalid','','now()','now()','now()'),
 ('81000000-0000-4000-8000-000000000005','authenticated','authenticated','employee-new@example.invalid','','now()','now()','now()'),
 ('81000000-0000-4000-8000-000000000006','authenticated','authenticated','admin-new@example.invalid','','now()','now()','now()'),
 ('81000000-0000-4000-8000-000000000007','authenticated','authenticated','wrong-email@example.invalid','','now()','now()','now()'),
 ('81000000-0000-4000-8000-000000000008','authenticated','authenticated','revoked-invitee@example.invalid','','now()','now()','now()'),
 ('81000000-0000-4000-8000-000000000009','authenticated','authenticated','unlinked-worker@example.invalid','','now()','now()','now()');
insert into public.companies(id,name) values
 ('82000000-0000-4000-8000-000000000001','Access synthetic A'),
 ('82000000-0000-4000-8000-000000000002','Access synthetic B');
insert into public.branches(id,company_id,name,timezone) values
 ('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Access branch A','America/Mexico_City'),
 ('83000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002','Access branch B','America/Mexico_City');
insert into public.employees(id,company_id,branch_id,employee_number,first_name,last_name,email) values
 ('84000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','ACCESS-A','Ana','Empleado','employee-new@example.invalid'),
 ('84000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002','ACCESS-B','Beto','Empleado','employee-b@example.invalid'),
 ('84000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','ACCESS-LINK','Luz','Vinculación','unlinked-worker@example.invalid');
select set_config('request.jwt.claim.role','service_role',true);
insert into public.company_memberships(id,company_id,user_id,role,active) values
 ('85000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','owner',true),
 ('85000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','admin',true),
 ('85000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','owner',true),
 ('85000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000007','employee',true),
 ('85000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000009','employee',true);

create temporary table _access_test_invites(kind text primary key,id uuid not null) on commit drop;
grant all on table _access_test_invites to authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000002","email":"admin-a@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
set local role authenticated;

select is(jsonb_array_length(public.list_company_user_access('82000000-0000-4000-8000-000000000001')->'users'),4,'admin lists memberships in its company');
select throws_ok($$select public.list_company_user_access('82000000-0000-4000-8000-000000000002')$$,'42501',null,'admin cannot list another company');
insert into _access_test_invites values ('supervisor',public.create_company_user_invitation('82000000-0000-4000-8000-000000000001','supervisor-new@example.invalid','supervisor',null));
select ok((select id is not null from _access_test_invites where kind='supervisor'),'supervisor invitation is created in the active company');
select throws_ok($$select public.create_company_user_invitation('82000000-0000-4000-8000-000000000001','admin-new@example.invalid','admin',null)$$,'42501',null,'regular admin cannot invite another administrator');
select throws_ok($$select public.create_company_user_invitation('82000000-0000-4000-8000-000000000001','owner-new@example.invalid','owner',null)$$,'22023',null,'owner privilege cannot be granted through invitations');
select throws_ok($$select public.create_company_user_invitation('82000000-0000-4000-8000-000000000002','outsider@example.invalid','employee',null)$$,'42501',null,'admin cannot create an invitation in another company');
select throws_ok($$update public.company_memberships set role='admin' where id='85000000-0000-4000-8000-000000000001'$$,'42501',null,'direct membership writes are denied to authenticated');
select ok(not has_table_privilege('authenticated','public.company_user_invitations','INSERT'),'invitation rows cannot be inserted directly');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000007","email":"wrong-email@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000007',true);
select throws_ok(format('select public.accept_company_user_invitation(%L)',(select id from _access_test_invites where kind='supervisor')),'P0002',null,'another identity cannot accept the invitation');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000004","email":"supervisor-new@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000004',true);
select lives_ok(format('select * from public.accept_company_user_invitation(%L)',(select id from _access_test_invites where kind='supervisor')),'invitee accepts with the matching Auth identity');
reset role;
select is((select role::text from public.company_memberships where company_id='82000000-0000-4000-8000-000000000001' and user_id='81000000-0000-4000-8000-000000000004'),'supervisor','acceptance creates the intended supervisor membership');
select ok(exists(select 1 from public.supervisors where company_id='82000000-0000-4000-8000-000000000001' and membership_id=(select id from public.company_memberships where user_id='81000000-0000-4000-8000-000000000004')),'acceptance creates the supervisor profile');
insert into _access_test_invites values ('supervisor-membership',(select id from public.company_memberships where company_id='82000000-0000-4000-8000-000000000001' and user_id='81000000-0000-4000-8000-000000000004'));

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000002","email":"admin-a@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
insert into _access_test_invites values ('employee',public.create_company_user_invitation('82000000-0000-4000-8000-000000000001','employee-new@example.invalid','employee','84000000-0000-4000-8000-000000000001'));
reset role;
select is((select count(*)::integer from auth.users where lower(email)='employee-new@example.invalid'),1,'inviting an existing Auth user does not create another identity');
set local role authenticated;
select throws_ok($$select public.create_company_user_invitation('82000000-0000-4000-8000-000000000001','wrong-email@example.invalid','employee','84000000-0000-4000-8000-000000000001')$$,'23503',null,'employee expediente cannot be linked to a different email');
select throws_ok($$select public.create_company_user_invitation('82000000-0000-4000-8000-000000000001','employee-new@example.invalid','employee','84000000-0000-4000-8000-000000000002')$$,'23503',null,'cross-company employee records cannot be linked');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000005","email":"employee-new@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000005',true);
select lives_ok(format('select * from public.accept_company_user_invitation(%L)',(select id from _access_test_invites where kind='employee')),'employee invitee accepts using its authenticated email');
reset role;
select is((select auth_user_id::text from public.employees where id='84000000-0000-4000-8000-000000000001'),'81000000-0000-4000-8000-000000000005','acceptance links the selected company expediente');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000002","email":"admin-a@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.link_employee_account('82000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000004','84000000-0000-4000-8000-000000000003')$$,'P0002',null,'a different employee email cannot be linked to the account');
select throws_ok($$select public.link_employee_account('82000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000005','84000000-0000-4000-8000-000000000002')$$,'P0002',null,'an employee account cannot link a record from another company');
select lives_ok($$select public.link_employee_account('82000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000005','84000000-0000-4000-8000-000000000003')$$,'manager links an existing employee account to the matching expediente');
reset role;
select is((select auth_user_id::text from public.employees where id='84000000-0000-4000-8000-000000000003'),'81000000-0000-4000-8000-000000000009','existing account link stores the selected auth_user_id');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000005","email":"employee-new@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000005',true);
reset role;
select set_config('request.jwt.claim.role','service_role',true);
insert into public.membership_permission_overrides(company_id,membership_id,permission_code,allowed)
 select '82000000-0000-4000-8000-000000000001',id,'company.manage',true from public.company_memberships where user_id='81000000-0000-4000-8000-000000000005';
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000005","email":"employee-new@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select throws_ok($$select public.list_company_user_access('82000000-0000-4000-8000-000000000001')$$,'42501',null,'a permission override cannot turn an employee into a user manager');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000002","email":"admin-a@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.create_company_user_invitation('82000000-0000-4000-8000-000000000001','admin-new@example.invalid','admin',null)$$,'42501',null,'admin cannot create administrator invite');
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000001","email":"owner-a@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into _access_test_invites values ('admin',public.create_company_user_invitation('82000000-0000-4000-8000-000000000001','admin-new@example.invalid','admin',null));
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000006","email":"admin-new@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000006',true);
select lives_ok(format('select * from public.accept_company_user_invitation(%L)',(select id from _access_test_invites where kind='admin')),'owner-authorized admin invite is accepted');
reset role;
select is((select role::text from public.company_memberships where company_id='82000000-0000-4000-8000-000000000001' and user_id='81000000-0000-4000-8000-000000000006'),'admin','accepted administrator receives only the invited company role');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000002","email":"admin-a@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.change_company_membership_role('82000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001','employee')$$,'42501',null,'admin cannot alter the owner role');
select throws_ok(format('select public.change_company_membership_role(%L,%L,''admin'')','82000000-0000-4000-8000-000000000001',(select id from _access_test_invites where kind='supervisor-membership')),'42501',null,'admin cannot promote a supervisor to administrator');
select throws_ok($$select public.change_company_membership_role('82000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000003','employee')$$,'42501',null,'admin cannot change another company membership');
select lives_ok(format('select public.deactivate_company_membership(%L,%L)','82000000-0000-4000-8000-000000000001',(select id from _access_test_invites where kind='supervisor-membership')),'admin may deactivate a supervisor in its own company');
select throws_ok($$select public.deactivate_company_membership('82000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000003')$$,'42501',null,'admin cannot deactivate a membership in another company');
select throws_ok($$select public.deactivate_company_membership('82000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000002')$$,'42501',null,'user cannot deactivate its own access');
insert into _access_test_invites values ('revoked',public.create_company_user_invitation('82000000-0000-4000-8000-000000000001','revoked-invitee@example.invalid','employee',null));
select lives_ok(format('select public.revoke_company_user_invitation(%L,%L)','82000000-0000-4000-8000-000000000001',(select id from _access_test_invites where kind='revoked')),'company admin can revoke a pending invitation');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000008","email":"revoked-invitee@example.invalid"}',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000008',true);
select throws_ok(format('select public.accept_company_user_invitation(%L)',(select id from _access_test_invites where kind='revoked')),'P0002',null,'revoked invite cannot create a membership');
reset role;
select ok(not (select active from public.company_memberships where user_id='81000000-0000-4000-8000-000000000004'),'deactivation marks only the company membership inactive');
select is((select count(*)::integer from public.company_memberships where company_id='82000000-0000-4000-8000-000000000002' and user_id='81000000-0000-4000-8000-000000000003'),1,'other company membership remains unchanged');
select is((select status from public.company_user_invitations where id=(select id from _access_test_invites where kind='revoked')),'revoked','revocation is persisted without deleting invitation history');

select * from finish();
rollback;
