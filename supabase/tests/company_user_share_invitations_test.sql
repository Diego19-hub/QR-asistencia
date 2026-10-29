begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select has_column('public','company_user_invitations','share_token_hash','share invitation stores only an optional token hash');
select ok((select c.relrowsecurity from pg_class c where c.oid='public.company_user_invitations'::regclass),'share tokens remain protected by invitation table RLS');
select ok(not has_table_privilege('authenticated','public.company_user_invitations','SELECT'),'authenticated users cannot read raw invitation hashes');
select ok(has_function_privilege('authenticated','public.set_company_user_invitation_share_link(uuid,uuid,text)','EXECUTE'),'authenticated managers can request an authorized share link');
select ok(not has_function_privilege('anon','public.set_company_user_invitation_share_link(uuid,uuid,text)','EXECUTE'),'anonymous users cannot create share links');
select ok(has_function_privilege('authenticated','public.accept_company_user_share_invitation(text)','EXECUTE'),'authenticated users can try accepting with a share token');
select ok(not has_function_privilege('anon','public.accept_company_user_share_invitation(text)','EXECUTE'),'anonymous users cannot accept a share invitation');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
  where p.oid='public.set_company_user_invitation_share_link(uuid,uuid,text)'::regprocedure),'share link creation is SECURITY DEFINER with an empty search_path');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
  where p.oid='public.accept_company_user_share_invitation(text)'::regprocedure),'share acceptance is SECURITY DEFINER with an empty search_path');
select matches(pg_get_functiondef('public.set_company_user_invitation_share_link(uuid,uuid,text)'::regprocedure),
  'company\.manage','share creation requires company.manage');
select matches(pg_get_functiondef('public.set_company_user_invitation_share_link(uuid,uuid,text)'::regprocedure),
  'USER_INVITATION_SHARE_LINK_CREATED','share link creation is audited');
select matches(pg_get_functiondef('public.accept_company_user_share_invitation(text)'::regprocedure),
  'email_confirmed_at','share acceptance requires a verified Auth email');
select matches(pg_get_functiondef('public.accept_company_user_share_invitation(text)'::regprocedure),
  'share_token_hash','share acceptance checks the stored hash');
select matches(pg_get_functiondef('public.list_company_user_access(uuid)'::regprocedure),
  'shareLinkCreated','authorized administration sees only whether a link exists');

select * from finish();
rollback;
