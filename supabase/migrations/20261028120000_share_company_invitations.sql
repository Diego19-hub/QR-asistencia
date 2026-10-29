-- Adds an optional one-time WhatsApp link to an existing email invitation.
-- The browser receives the raw token once; only its SHA-256 hash is persisted.
alter table public.company_user_invitations
  add column share_token_hash text
  check (share_token_hash is null or share_token_hash ~ '^[a-f0-9]{64}$');

create unique index company_user_invitations_share_token_hash
  on public.company_user_invitations(share_token_hash)
  where share_token_hash is not null;

create or replace function public.list_company_user_access(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or not exists(select 1 from public.company_memberships m
      where m.company_id=p_company_id and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin'))
     or not private.has_company_permission(p_company_id,'company.manage') then
    raise exception 'company access denied' using errcode='42501';
  end if;
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membershipId',m.id,'userId',u.id,'email',u.email,'role',m.role,
        'active',m.active,'emailConfirmed',u.email_confirmed_at is not null,
        'createdAt',m.created_at,'employeeId',e.id,
        'employeeName',case when e.id is null then null else trim(e.first_name||' '||e.last_name) end,
        'branches',coalesce((select jsonb_agg(sb.branch_id order by sb.branch_id)
          from public.supervisor_branches sb where sb.company_id=m.company_id and sb.membership_id=m.id),'[]'::jsonb)
      ) order by m.created_at,u.email)
      from public.company_memberships m join auth.users u on u.id=m.user_id
      left join public.employees e on e.company_id=m.company_id and e.auth_user_id=m.user_id
      where m.company_id=p_company_id
    ),'[]'::jsonb),
    'invitations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'email',i.email,'role',i.role,'employeeId',i.employee_id,
        'status',case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end,
        'createdAt',i.created_at,'expiresAt',i.expires_at,
        'shareLinkCreated',i.share_token_hash is not null
      ) order by i.created_at desc)
      from public.company_user_invitations i where i.company_id=p_company_id
    ),'[]'::jsonb),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name)
      from public.branches b where b.company_id=p_company_id and b.active),'[]'::jsonb),
    'unlinkedEmployees',coalesce((select jsonb_agg(jsonb_build_object(
       'id',e.id,'name',trim(e.first_name||' '||e.last_name),'email',e.email,'employeeNumber',e.employee_number
      ) order by e.last_name,e.first_name)
      from public.employees e where e.company_id=p_company_id and e.active and e.auth_user_id is null),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.set_company_user_invitation_share_link(
  p_company_id uuid,p_invitation_id uuid,p_token_hash text
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare actor_role public.company_role; target_role public.company_role; target_expiry timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid token hash' using errcode='22023'; end if;
  select m.role into actor_role from public.company_memberships m
    where m.company_id=p_company_id and m.user_id=(select auth.uid()) and m.active for update;
  if actor_role is null or actor_role not in ('owner','admin')
     or not private.has_company_permission(p_company_id,'company.manage') then
    raise exception 'company access denied' using errcode='42501';
  end if;
  select i.role,i.expires_at into target_role,target_expiry from public.company_user_invitations i
    where i.company_id=p_company_id and i.id=p_invitation_id and i.status='pending' and i.expires_at>now() for update;
  if not found then raise exception 'invitation unavailable' using errcode='P0002'; end if;
  if target_role='admin' and actor_role<>'owner' then raise exception 'owner required' using errcode='42501'; end if;
  update public.company_user_invitations set share_token_hash=p_token_hash
    where company_id=p_company_id and id=p_invitation_id;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
    values(p_company_id,(select auth.uid()),'USER_INVITATION_SHARE_LINK_CREATED',
      'company_user_invitations',p_invitation_id,
      jsonb_build_object('channel','whatsapp','expires_at',target_expiry));
  return target_expiry;
end $$;

create or replace function public.revoke_company_user_invitation(p_company_id uuid,p_invitation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor_role public.company_role; target_role public.company_role;
begin
  select m.role into actor_role from public.company_memberships m where m.company_id=p_company_id
    and m.user_id=(select auth.uid()) and m.active;
  if actor_role not in ('owner','admin') or not private.has_company_permission(p_company_id,'company.manage') then
    raise exception 'company access denied' using errcode='42501';
  end if;
  select i.role into target_role from public.company_user_invitations i where i.company_id=p_company_id
    and i.id=p_invitation_id and i.status='pending' for update;
  if target_role is null then return false; end if;
  if target_role='admin' and actor_role<>'owner' then raise exception 'owner required' using errcode='42501'; end if;
  update public.company_user_invitations set status='revoked',share_token_hash=null where id=p_invitation_id;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
   values(p_company_id,(select auth.uid()),'USER_INVITATION_REVOKED','company_user_invitations',p_invitation_id,'{}'::jsonb);
  return true;
end $$;

create or replace function public.list_my_pending_company_invitations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; actor_email text;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  select lower(trim(u.email)) into actor_email from auth.users u
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null;
  if actor_email is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'companyId',i.company_id,'companyName',c.name,
      'role',i.role,'email',i.email,'expiresAt',i.expires_at,
      'shareLinkRequired',i.share_token_hash is not null) order by i.created_at), '[]'::jsonb)
   into result from public.company_user_invitations i join public.companies c on c.id=i.company_id
   where i.email=actor_email and i.status='pending' and i.expires_at>now();
  return result;
end $$;

create or replace function public.accept_company_user_invitation(p_invitation_id uuid)
returns table(company_id uuid,role public.company_role)
language plpgsql security definer set search_path = '' as $$
declare invite public.company_user_invitations%rowtype; existing public.company_memberships%rowtype;
       inviter public.company_memberships%rowtype; actor_id uuid; actor_email text;
begin
  actor_id:=(select auth.uid());
  select lower(trim(u.email)) into actor_email from auth.users u
    where u.id=actor_id and u.email_confirmed_at is not null;
  if actor_id is null or actor_email is null or actor_email='' then
    raise exception 'verified email authentication required' using errcode='42501';
  end if;
  select * into invite from public.company_user_invitations i where i.id=p_invitation_id
    and i.email=actor_email and i.share_token_hash is null and i.status='pending' and i.expires_at>now() for update;
  if not found then raise exception 'invitation unavailable' using errcode='P0002'; end if;
  select m.* into inviter from public.company_memberships m where m.company_id=invite.company_id
    and m.user_id=invite.invited_by and m.active;
  if not found or inviter.role not in ('owner','admin')
     or not exists (
       select 1 from public.role_permissions rp
       left join public.membership_permission_overrides o
         on o.company_id=inviter.company_id and o.membership_id=inviter.id
        and o.permission_code=rp.permission_code
       where rp.role=inviter.role and rp.permission_code='company.manage'
         and coalesce(o.allowed,true)
     )
     or (invite.role='admin' and inviter.role<>'owner') then
    raise exception 'invitation authorization expired' using errcode='42501';
  end if;
  select * into existing from public.company_memberships m where m.company_id=invite.company_id and m.user_id=actor_id for update;
  if found then
    if existing.active then raise exception 'user already has active company access' using errcode='23505'; end if;
    if existing.role='owner' then raise exception 'owner access cannot be changed through an invitation' using errcode='42501'; end if;
    if (invite.role='admin' or existing.role='admin') and inviter.role<>'owner' then raise exception 'owner required' using errcode='42501'; end if;
    update private.device_authorization_requests dar set status=case when status='pending' then 'rejected' else 'revoked' end,
      reviewed_at=coalesce(reviewed_at,clock_timestamp()),reviewed_by=coalesce(reviewed_by,actor_id)
     where dar.company_id=invite.company_id and dar.membership_id=existing.id and dar.status in ('pending','approved');
    update public.authorized_devices d set active=false,revoked_at=coalesce(revoked_at,clock_timestamp())
     where d.company_id=invite.company_id and d.membership_id=existing.id and d.active;
    delete from public.supervisor_branches sb where sb.company_id=invite.company_id and sb.membership_id=existing.id;
    delete from public.membership_permission_overrides o where o.company_id=invite.company_id and o.membership_id=existing.id;
    update public.company_memberships m set role=invite.role,active=true where m.id=existing.id;
  else
    insert into public.company_memberships(company_id,user_id,role,active)
     values(invite.company_id,actor_id,invite.role,true);
  end if;
  if invite.role='supervisor' then
    insert into public.supervisors(company_id,membership_id) values(invite.company_id,
      coalesce(existing.id,(select m.id from public.company_memberships m where m.company_id=invite.company_id and m.user_id=actor_id)))
      on conflict on constraint supervisors_pkey do nothing;
  elsif invite.role='employee' and invite.employee_id is not null then
    update public.employees e set auth_user_id=actor_id,updated_at=now()
      where e.company_id=invite.company_id and e.id=invite.employee_id and e.active and e.auth_user_id is null
        and (e.email is null or lower(trim(e.email))=actor_email);
    if not found then raise exception 'employee record unavailable' using errcode='23503'; end if;
  end if;
  update public.company_user_invitations i set status='accepted',accepted_at=now(),accepted_by=actor_id
    where i.id=invite.id;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
   values(invite.company_id,actor_id,'USER_INVITATION_ACCEPTED','company_user_invitations',invite.id,
     jsonb_build_object('role',invite.role,'employee_id',invite.employee_id));
  return query select invite.company_id,invite.role;
end $$;

create or replace function public.accept_company_user_share_invitation(p_token_hash text)
returns table(company_id uuid,role public.company_role)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; actor_email text; invitation_id uuid;
begin
  actor_id:=(select auth.uid());
  select lower(trim(u.email)) into actor_email from auth.users u
    where u.id=actor_id and u.email_confirmed_at is not null;
  if actor_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if actor_email is null or actor_email='' then
    raise exception 'verified email authentication required' using errcode='42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invitation unavailable' using errcode='P0002';
  end if;
  select i.id into invitation_id from public.company_user_invitations i
    where i.share_token_hash=p_token_hash and i.email=actor_email
      and i.status='pending' and i.expires_at>now() for update;
  if not found then raise exception 'invitation unavailable' using errcode='P0002'; end if;
  update public.company_user_invitations set share_token_hash=null where id=invitation_id;
  return query select * from public.accept_company_user_invitation(invitation_id);
end $$;

revoke all on function public.set_company_user_invitation_share_link(uuid,uuid,text) from public,anon;
revoke all on function public.accept_company_user_share_invitation(text) from public,anon;
grant execute on function public.set_company_user_invitation_share_link(uuid,uuid,text) to authenticated;
grant execute on function public.accept_company_user_share_invitation(text) to authenticated;
