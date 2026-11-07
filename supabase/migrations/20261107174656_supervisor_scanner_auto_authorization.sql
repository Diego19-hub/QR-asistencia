-- Bind a browser to a supervisor only after the server confirms its active
-- membership and active branch assignment. The browser token is never stored
-- in plaintext and every attendance RPC continues to resolve it through
-- private.scanner_device.

create or replace function public.ensure_supervisor_scanner_device(
  p_company_id uuid,
  p_branch_id uuid,
  p_label text,
  p_device_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  membership_id uuid;
  token_digest bytea;
  existing record;
  new_device_id uuid;
  normalized_label text := trim(p_label);
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  if normalized_label is null or length(normalized_label) not between 1 and 100
     or p_device_token !~ '^[A-Za-z0-9_-]{40,60}$' then
    raise exception 'invalid device enrollment' using errcode='22023';
  end if;

  -- Serialize enrollment against role, membership, branch and assignment
  -- changes. A concurrent revocation either waits for this transaction and
  -- deactivates the new device, or wins first and makes this check fail.
  select m.id into membership_id
  from public.company_memberships m
  join public.supervisors s
    on s.company_id=m.company_id and s.membership_id=m.id
  join public.supervisor_branches sb
    on sb.company_id=m.company_id and sb.membership_id=m.id
  join public.branches b
    on b.company_id=sb.company_id and b.id=sb.branch_id and b.active
  where m.company_id=p_company_id and m.id=sb.membership_id
    and m.user_id=actor_id and m.active and m.role='supervisor'
    and sb.branch_id=p_branch_id
    and private.has_company_permission(m.company_id,'attendance.scan')
  for update of m, sb, b;

  if membership_id is null then
    raise exception 'supervisor branch access denied' using errcode='42501';
  end if;

  token_digest:=extensions.digest(convert_to(p_device_token,'UTF8'),'sha256');
  select d.id,d.company_id,d.membership_id,d.branch_id,d.active,d.revoked_at
    into existing
  from private.device_token_hashes h
  join public.authorized_devices d on d.id=h.device_id
  where h.token_hash=token_digest
  for update of h,d;

  if found then
    if existing.company_id=p_company_id and existing.membership_id=membership_id
       and existing.branch_id=p_branch_id and existing.active and existing.revoked_at is null then
      return jsonb_build_object('deviceId',existing.id,'branchId',existing.branch_id,'authorized',true,'created',false);
    end if;
    -- A manually revoked token or a token bound to another tenant/device is
    -- a tombstone. Do not silently re-enable or transfer it.
    raise exception 'device token revoked or unavailable' using errcode='42501';
  end if;

  insert into public.authorized_devices(company_id,branch_id,membership_id,label)
  values(p_company_id,p_branch_id,membership_id,normalized_label)
  returning id into new_device_id;
  insert into private.device_token_hashes(device_id,token_hash)
  values(new_device_id,token_digest);
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
  values(p_company_id,actor_id,'SUPERVISOR_DEVICE_AUTO_AUTHORIZED','authorized_devices',new_device_id,
    jsonb_build_object('membershipId',membership_id,'branchId',p_branch_id,'label',normalized_label));

  return jsonb_build_object('deviceId',new_device_id,'branchId',p_branch_id,'authorized',true,'created',true);
end;
$$;
revoke all on function public.ensure_supervisor_scanner_device(uuid,uuid,text,text) from public,anon;
grant execute on function public.ensure_supervisor_scanner_device(uuid,uuid,text,text) to authenticated;

-- Keep existing per-device revocation effective. A branch unassignment is a
-- different event: remove only the token binding for devices scoped to that
-- branch so an already assigned active branch can enroll the same browser.
create or replace function public.set_supervisor_branch(
  p_company_id uuid,p_membership_id uuid,p_branch_id uuid,p_assigned boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_company_permission(p_company_id,'devices.manage') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  perform 1 from public.company_memberships m
   where m.company_id=p_company_id and m.id=p_membership_id
     and m.active and m.role='supervisor'
   for update;
  if not found or not exists(select 1 from public.branches b
      where b.company_id=p_company_id and b.id=p_branch_id and b.active) then
    raise exception 'supervisor or branch unavailable' using errcode='23514';
  end if;
  insert into public.supervisors(company_id,membership_id)
    values(p_company_id,p_membership_id) on conflict do nothing;
  if p_assigned then
    insert into public.supervisor_branches(company_id,membership_id,branch_id)
      values(p_company_id,p_membership_id,p_branch_id) on conflict do nothing;
  else
    delete from public.supervisor_branches
      where company_id=p_company_id and membership_id=p_membership_id and branch_id=p_branch_id;
    update private.device_authorization_requests
      set status=case when status='pending' then 'rejected' else 'revoked' end,
          reviewed_at=coalesce(reviewed_at,clock_timestamp()),
          reviewed_by=coalesce(reviewed_by,(select auth.uid()))
      where company_id=p_company_id and membership_id=p_membership_id
        and branch_id=p_branch_id and status in ('pending','approved');
    update public.authorized_devices
      set active=false,revoked_at=coalesce(revoked_at,clock_timestamp())
      where company_id=p_company_id and membership_id=p_membership_id
        and branch_id=p_branch_id and active;
    delete from private.device_token_hashes h
      using public.authorized_devices d
      where h.device_id=d.id and d.company_id=p_company_id
        and d.membership_id=p_membership_id and d.branch_id=p_branch_id;
  end if;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
  values(p_company_id,(select auth.uid()),
    case when p_assigned then 'SUPERVISOR_BRANCH_ASSIGNED' else 'SUPERVISOR_BRANCH_UNASSIGNED' end,
    'supervisor_branches',p_membership_id,jsonb_build_object('branchId',p_branch_id));
  return jsonb_build_object('membershipId',p_membership_id,'branchId',p_branch_id,'assigned',p_assigned);
end;
$$;
revoke all on function public.set_supervisor_branch(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.set_supervisor_branch(uuid,uuid,uuid,boolean) to authenticated;
