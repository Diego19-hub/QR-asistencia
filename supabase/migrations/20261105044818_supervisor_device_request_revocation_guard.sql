-- Keep supervisor device approval aligned with the current membership,
-- branch assignment and branch activation state.

create or replace function private.scanner_device(p_company_id uuid, p_device_token text)
returns table(device_id uuid, membership_id uuid, branch_id uuid)
language sql security definer set search_path = '' as $$
  select d.id, d.membership_id, d.branch_id
  from public.authorized_devices d
  join private.device_token_hashes h on h.device_id=d.id
  join public.company_memberships m on m.company_id=d.company_id and m.id=d.membership_id
  join public.branches b on b.company_id=d.company_id and b.id=d.branch_id and b.active
  where d.company_id=p_company_id and d.active and d.revoked_at is null
    and m.user_id=(select auth.uid()) and m.active and m.role='supervisor'
    and private.has_company_permission(d.company_id,'attendance.scan')
    and exists(select 1 from public.supervisors s where s.company_id=d.company_id and s.membership_id=d.membership_id)
    and exists(select 1 from public.supervisor_branches sb where sb.company_id=d.company_id
      and sb.membership_id=d.membership_id and sb.branch_id=d.branch_id)
    and h.token_hash=extensions.digest(convert_to(p_device_token,'UTF8'),'sha256')
  limit 1
$$;
revoke all on function private.scanner_device(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.review_supervisor_device_request(p_company_id uuid,p_request_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare req private.device_authorization_requests%rowtype; eligible_membership uuid; new_device uuid;
begin
  if (select auth.uid()) is null or not private.has_company_permission(p_company_id,'devices.manage') then
    raise exception 'permission denied' using errcode='42501';
  end if;

  -- Read the target identifiers first, then lock mutable authorization rows in
  -- the same order as branch/role revocation before locking the request row.
  select * into req from private.device_authorization_requests
   where id=p_request_id and company_id=p_company_id;
  if not found then raise exception 'request not found' using errcode='P0002'; end if;
  if req.status <> 'pending' then raise exception 'request already reviewed' using errcode='23514'; end if;

  if p_approve then
    select m.id into eligible_membership
      from public.company_memberships m
      join public.supervisors s on s.company_id=m.company_id and s.membership_id=m.id
      join public.supervisor_branches sb on sb.company_id=m.company_id and sb.membership_id=m.id
      join public.branches b on b.company_id=sb.company_id and b.id=sb.branch_id
     where m.company_id=req.company_id and m.id=req.membership_id
       and m.active and m.role='supervisor' and sb.branch_id=req.branch_id and b.active
     for share of m,sb,b;
    if eligible_membership is null then
      raise exception 'supervisor assignment unavailable' using errcode='23514';
    end if;
  end if;

  select * into req from private.device_authorization_requests
   where id=p_request_id and company_id=p_company_id for update;
  if not found then raise exception 'request not found' using errcode='P0002'; end if;
  if req.status <> 'pending' then raise exception 'request already reviewed' using errcode='23514'; end if;

  if p_approve then
    insert into public.authorized_devices(company_id,branch_id,membership_id,label)
      values(req.company_id,req.branch_id,req.membership_id,req.label) returning id into new_device;
  end if;
  update private.device_authorization_requests set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=(select auth.uid()),reviewed_at=clock_timestamp(),device_id=new_device where id=req.id;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,before_data,after_data)
  values(p_company_id,(select auth.uid()),case when p_approve then 'DEVICE_AUTHORIZATION_APPROVED' else 'DEVICE_AUTHORIZATION_REJECTED' end,
    'device_authorization_requests',req.id,jsonb_build_object('status','pending'),
    jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end,'deviceId',new_device));
  return jsonb_build_object('requestId',req.id,'status',case when p_approve then 'approved' else 'rejected' end,'deviceId',new_device);
end $$;
revoke all on function public.review_supervisor_device_request(uuid,uuid,boolean) from public,anon;
grant execute on function public.review_supervisor_device_request(uuid,uuid,boolean) to authenticated;

create or replace function public.set_supervisor_branch(p_company_id uuid,p_membership_id uuid,p_branch_id uuid,p_assigned boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.has_company_permission(p_company_id,'devices.manage') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.id=p_membership_id and m.active and m.role='supervisor')
     or not exists(select 1 from public.branches b where b.company_id=p_company_id and b.id=p_branch_id and b.active) then
    raise exception 'supervisor or branch unavailable' using errcode='23514';
  end if;
  insert into public.supervisors(company_id,membership_id) values(p_company_id,p_membership_id) on conflict do nothing;
  if p_assigned then
    insert into public.supervisor_branches(company_id,membership_id,branch_id) values(p_company_id,p_membership_id,p_branch_id) on conflict do nothing;
  else
    delete from public.supervisor_branches where company_id=p_company_id and membership_id=p_membership_id and branch_id=p_branch_id;
    update private.device_authorization_requests
      set status=case when status='pending' then 'rejected' else 'revoked' end,
          reviewed_at=coalesce(reviewed_at,clock_timestamp()),reviewed_by=coalesce(reviewed_by,(select auth.uid()))
     where company_id=p_company_id and membership_id=p_membership_id and branch_id=p_branch_id
       and status in ('pending','approved');
    update public.authorized_devices set active=false,revoked_at=coalesce(revoked_at,clock_timestamp())
     where company_id=p_company_id and membership_id=p_membership_id and branch_id=p_branch_id and active;
  end if;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
  values(p_company_id,(select auth.uid()),case when p_assigned then 'SUPERVISOR_BRANCH_ASSIGNED' else 'SUPERVISOR_BRANCH_UNASSIGNED' end,
    'supervisor_branches',p_membership_id,jsonb_build_object('branchId',p_branch_id));
  return jsonb_build_object('membershipId',p_membership_id,'branchId',p_branch_id,'assigned',p_assigned);
end $$;
revoke all on function public.set_supervisor_branch(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.set_supervisor_branch(uuid,uuid,uuid,boolean) to authenticated;
