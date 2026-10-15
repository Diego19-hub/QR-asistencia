begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

select has_table('public','company_user_invitations','company-scoped invitations table exists');
select ok((select c.relrowsecurity from pg_class c where c.oid='public.company_user_invitations'::regclass),'invitations have RLS enabled');
select ok(not has_table_privilege('anon','public.company_user_invitations','SELECT'),'anon cannot read invitations');
select ok(not has_table_privilege('authenticated','public.company_user_invitations','SELECT'),'users cannot read invitation rows directly');
select ok(not has_table_privilege('authenticated','public.company_user_invitations','INSERT'),'users cannot create invitation rows directly');
select ok(not has_table_privilege('authenticated','public.company_memberships','INSERT'),'authenticated cannot write memberships directly');
select ok(not has_table_privilege('authenticated','public.company_memberships','UPDATE'),'authenticated cannot change roles or active state directly');
select ok(not has_table_privilege('authenticated','public.company_memberships','DELETE'),'authenticated cannot delete memberships directly');

select ok(has_function_privilege('authenticated','public.list_company_user_access(uuid)','EXECUTE'),'authenticated can list through the authorization-checked RPC');
select ok(not has_function_privilege('anon','public.list_company_user_access(uuid)','EXECUTE'),'anon cannot list company users');
select ok(has_function_privilege('authenticated','public.create_company_user_invitation(uuid,text,public.company_role,uuid)','EXECUTE'),'authenticated can request an invitation through the checked RPC');
select ok(not has_function_privilege('anon','public.create_company_user_invitation(uuid,text,public.company_role,uuid)','EXECUTE'),'anon cannot create invitations');
select ok(has_function_privilege('authenticated','public.accept_company_user_invitation(uuid)','EXECUTE'),'authenticated can accept only an email-matched invitation');
select ok(not has_function_privilege('anon','public.accept_company_user_invitation(uuid)','EXECUTE'),'anon cannot accept invitations');
select ok(has_function_privilege('authenticated','public.change_company_membership_role(uuid,uuid,public.company_role)','EXECUTE'),'role changes use checked RPC');
select ok(not has_function_privilege('anon','public.change_company_membership_role(uuid,uuid,public.company_role)','EXECUTE'),'anon cannot change roles');
select ok(has_function_privilege('authenticated','public.deactivate_company_membership(uuid,uuid)','EXECUTE'),'membership deactivation uses checked RPC');
select ok(not has_function_privilege('anon','public.deactivate_company_membership(uuid,uuid)','EXECUTE'),'anon cannot deactivate memberships');

select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
  from pg_proc p where p.oid='public.accept_company_user_invitation(uuid)'::regprocedure),'accept RPC is SECURITY DEFINER with an empty search_path');
select matches(pg_get_functiondef('public.accept_company_user_invitation(uuid)'::regprocedure),'auth\.jwt\(\)','acceptance compares the authenticated JWT email');
select matches(pg_get_functiondef('public.accept_company_user_invitation(uuid)'::regprocedure),'invited_by','acceptance revalidates the inviter membership');
select matches(pg_get_functiondef('public.create_company_user_invitation(uuid,text,public.company_role,uuid)'::regprocedure),'actor_role\s*<>\s*''owner''','only owner may invite administrators');
select matches(pg_get_functiondef('public.list_company_user_access(uuid)'::regprocedure),'m\.role\s+in\s*\(''owner'',''admin''\)','permission overrides cannot make a non-admin a user manager');
select ok(has_function_privilege('authenticated','public.link_employee_account(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.link_employee_account(uuid,uuid,uuid)','EXECUTE'),
  'employee account linking is limited to authenticated users through the checked RPC');
select ok(has_function_privilege('service_role','public.bootstrap_first_company(uuid,uuid,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.bootstrap_first_company(uuid,uuid,text,text,text)','EXECUTE'),
  'initial owner bootstrap remains service_role-only');

select * from finish();
rollback;
