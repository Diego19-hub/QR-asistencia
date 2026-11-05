-- Serialize device enrollment with membership/branch revocation. Without row
-- locks, enrollment can validate the old committed authorization while a
-- revocation transaction has already cleaned existing requests, then insert a
-- new pending request after that cleanup.
create or replace function public.request_supervisor_device(p_company_id uuid,p_branch_id uuid,p_label text,p_challenge text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare mid uuid; req uuid; normalized_label text;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  normalized_label:=trim(p_label);
  if normalized_label is null or length(normalized_label) not between 1 and 100
     or p_challenge !~ '^[A-Za-z0-9_-]{40,60}$' then
    raise exception 'invalid device request' using errcode='22023';
  end if;
  select m.id into mid from public.company_memberships m
    join public.supervisors s on s.company_id=m.company_id and s.membership_id=m.id
    join public.supervisor_branches sb on sb.company_id=m.company_id and sb.membership_id=m.id
    join public.branches b on b.company_id=sb.company_id and b.id=sb.branch_id and b.active
   where m.company_id=p_company_id and sb.branch_id=p_branch_id and m.user_id=(select auth.uid())
     and m.role='supervisor' and m.active and private.has_company_permission(m.company_id,'attendance.scan')
   for share of m,sb,b;
  if mid is null then raise exception 'supervisor branch access denied' using errcode='42501'; end if;
  select id into req from private.device_authorization_requests
   where membership_id=mid and branch_id=p_branch_id and challenge_hash=extensions.digest(convert_to(p_challenge,'UTF8'),'sha256')
     and status in ('pending','approved') and (status='pending' or redeemed_at is null)
   order by requested_at desc limit 1;
  if req is null then
    insert into private.device_authorization_requests(company_id,branch_id,membership_id,label,challenge_hash)
    values(p_company_id,p_branch_id,mid,normalized_label,extensions.digest(convert_to(p_challenge,'UTF8'),'sha256'))
    returning id into req;
    insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
    values(p_company_id,(select auth.uid()),'DEVICE_AUTHORIZATION_REQUESTED','device_authorization_requests',req,
      jsonb_build_object('branchId',p_branch_id,'label',normalized_label));
  end if;
  return jsonb_build_object('requestId',req,'status',(select status from private.device_authorization_requests where id=req));
end $$;
revoke all on function public.request_supervisor_device(uuid,uuid,text,text) from public,anon;
grant execute on function public.request_supervisor_device(uuid,uuid,text,text) to authenticated;
