-- Tenant-scoped access invitations. Auth identities are invited only by the
-- trusted Next.js server; membership changes are accepted by authenticated RPCs.
create table public.company_user_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  email text not null check (email = lower(trim(email)) and length(email) between 3 and 254),
  role public.company_role not null check (role in ('admin','supervisor','employee')),
  employee_id uuid,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete restrict,
  unique (company_id,id),
  foreign key (company_id,employee_id) references public.employees(company_id,id) on delete restrict,
  check ((role = 'employee') or employee_id is null)
);
create unique index company_user_invitations_one_pending_email
  on public.company_user_invitations(company_id,email) where status='pending';
create index company_user_invitations_company_created
  on public.company_user_invitations(company_id,created_at desc);
alter table public.company_user_invitations enable row level security;
revoke all on public.company_user_invitations from public,anon,authenticated,service_role;

-- Never allow API clients to write memberships directly. This closes the old
-- company.manage policy's privilege-escalation path; the owner bootstrap stays
-- service_role-only and is not changed by this migration.
drop policy if exists memberships_insert on public.company_memberships;
drop policy if exists memberships_update on public.company_memberships;
drop policy if exists memberships_delete on public.company_memberships;
revoke insert,update,delete on public.company_memberships from anon,authenticated;

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
        'createdAt',i.created_at,'expiresAt',i.expires_at
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

create or replace function public.create_company_user_invitation(
  p_company_id uuid,p_email text,p_role public.company_role,p_employee_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_role public.company_role; invitation_id uuid; normalized_email text;
begin
  select m.role into actor_role from public.company_memberships m
   where m.company_id=p_company_id and m.user_id=(select auth.uid()) and m.active for update;
  if actor_role not in ('owner','admin') or not private.has_company_permission(p_company_id,'company.manage') then
    raise exception 'company access denied' using errcode='42501';
  end if;
  if p_role not in ('admin','supervisor','employee') then
    raise exception 'role cannot be invited' using errcode='22023';
  end if;
  if p_role='admin' and actor_role<>'owner' then
    raise exception 'only the company owner can invite administrators' using errcode='42501';
  end if;
  normalized_email:=lower(trim(coalesce(p_email,'')));
  if length(normalized_email) not between 3 and 254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'valid email required' using errcode='22023';
  end if;
  if (p_role='employee' and p_employee_id is not null) then
    perform 1 from public.employees e where e.company_id=p_company_id and e.id=p_employee_id
      and e.active and e.auth_user_id is null
      and (e.email is null or lower(trim(e.email))=normalized_email) for update;
    if not found then raise exception 'employee record unavailable' using errcode='23503'; end if;
  elsif p_employee_id is not null then
    raise exception 'employee record only applies to employee role' using errcode='22023';
  end if;
  update public.company_user_invitations set status='expired'
   where company_id=p_company_id and email=normalized_email and status='pending' and expires_at<=now();
  if exists(select 1 from public.company_memberships m join auth.users u on u.id=m.user_id
       where m.company_id=p_company_id and lower(u.email)=normalized_email and m.active) then
    raise exception 'user already has active company access' using errcode='23505';
  end if;
  if exists(select 1 from public.company_memberships m join auth.users u on u.id=m.user_id
       where m.company_id=p_company_id and lower(u.email)=normalized_email and not m.active and m.role='owner') then
    raise exception 'owner access cannot be restored through an invitation' using errcode='42501';
  end if;
  if actor_role<>'owner' and exists(select 1 from public.company_memberships m join auth.users u on u.id=m.user_id
       where m.company_id=p_company_id and lower(u.email)=normalized_email and not m.active and m.role='admin') then
    raise exception 'only the owner can manage administrator access' using errcode='42501';
  end if;
  insert into public.company_user_invitations(company_id,email,role,employee_id,invited_by)
   values(p_company_id,normalized_email,p_role,p_employee_id,(select auth.uid()))
   returning id into invitation_id;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
   values(p_company_id,(select auth.uid()),'USER_INVITATION_CREATED','company_user_invitations',invitation_id,
     jsonb_build_object('email',normalized_email,'role',p_role,'employee_id',p_employee_id));
  return invitation_id;
exception when unique_violation then
  raise exception 'a pending invitation already exists for this address' using errcode='23505';
end $$;

create or replace function public.get_company_user_invitation_for_delivery(p_company_id uuid,p_invitation_id uuid)
returns table(id uuid,email text,role public.company_role)
language plpgsql stable security definer set search_path = '' as $$
declare actor_role public.company_role;
begin
  select m.role into actor_role from public.company_memberships m where m.company_id=p_company_id
    and m.user_id=(select auth.uid()) and m.active;
  if actor_role not in ('owner','admin') or not private.has_company_permission(p_company_id,'company.manage') then
    raise exception 'company access denied' using errcode='42501';
  end if;
  return query select i.id,i.email,i.role from public.company_user_invitations i
    where i.company_id=p_company_id and i.id=p_invitation_id and i.status='pending' and i.expires_at>now()
      and (i.role<>'admin' or actor_role='owner');
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
  update public.company_user_invitations set status='revoked' where id=p_invitation_id;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
   values(p_company_id,(select auth.uid()),'USER_INVITATION_REVOKED','company_user_invitations',p_invitation_id,'{}'::jsonb);
  return true;
end $$;

create or replace function public.list_my_pending_company_invitations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; actor_email text;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  actor_email:=lower(trim(coalesce((select auth.jwt()->>'email'),'')));
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'companyId',i.company_id,'companyName',c.name,
      'role',i.role,'email',i.email,'expiresAt',i.expires_at) order by i.created_at), '[]'::jsonb)
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
  actor_email:=lower(trim(coalesce((select auth.jwt()->>'email'),'')));
  if actor_id is null or actor_email='' then raise exception 'authentication required' using errcode='42501'; end if;
  select * into invite from public.company_user_invitations i where i.id=p_invitation_id
    and i.email=actor_email and i.status='pending' and i.expires_at>now() for update;
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
  update public.company_user_invitations i set status='accepted',accepted_at=now(),accepted_by=actor_id where i.id=invite.id;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
   values(invite.company_id,actor_id,'USER_INVITATION_ACCEPTED','company_user_invitations',invite.id,
     jsonb_build_object('role',invite.role,'employee_id',invite.employee_id));
  return query select invite.company_id,invite.role;
end $$;

create or replace function public.link_employee_account(p_company_id uuid,p_membership_id uuid,p_employee_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_role public.company_role; target public.company_memberships%rowtype; target_email text;
begin
  select m.role into actor_role from public.company_memberships m where m.company_id=p_company_id
    and m.user_id=(select auth.uid()) and m.active;
  if actor_role not in ('owner','admin') or not private.has_company_permission(p_company_id,'company.manage') then
    raise exception 'company access denied' using errcode='42501';
  end if;
  select * into target from public.company_memberships m where m.company_id=p_company_id
    and m.id=p_membership_id and m.role='employee' and m.active for update;
  if not found then raise exception 'employee account unavailable' using errcode='P0002'; end if;
  select lower(trim(u.email)) into target_email from auth.users u where u.id=target.user_id and u.email_confirmed_at is not null;
  if target_email is null then raise exception 'employee account requires a verified email identity' using errcode='22023'; end if;
  perform 1 from public.employees e where e.company_id=p_company_id and e.id=p_employee_id
    and e.active and e.auth_user_id is null
    and (e.email is null or lower(trim(e.email))=target_email) for update;
  if not found then raise exception 'employee record unavailable' using errcode='P0002'; end if;
  update public.employees set auth_user_id=target.user_id,updated_at=now()
   where company_id=p_company_id and id=p_employee_id and active and auth_user_id is null
     and (email is null or lower(trim(email))=target_email);
  if not found then raise exception 'employee record unavailable' using errcode='P0002'; end if;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
   values(p_company_id,(select auth.uid()),'USER_EMPLOYEE_LINKED','employees',p_employee_id,
     jsonb_build_object('membershipId',target.id,'employeeUserId',target.user_id));
  return p_employee_id;
end $$;

create or replace function public.change_company_membership_role(p_company_id uuid,p_membership_id uuid,p_role public.company_role)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor_role public.company_role; target public.company_memberships%rowtype; old_overrides jsonb;
begin
  select m.role into actor_role from public.company_memberships m where m.company_id=p_company_id
    and m.user_id=(select auth.uid()) and m.active;
  if actor_role not in ('owner','admin') or not private.has_company_permission(p_company_id,'company.manage') then
    raise exception 'company access denied' using errcode='42501';
  end if;
  if p_role not in ('admin','supervisor','employee') then raise exception 'role cannot be assigned' using errcode='22023'; end if;
  select * into target from public.company_memberships m where m.company_id=p_company_id and m.id=p_membership_id for update;
  if not found then raise exception 'membership unavailable' using errcode='P0002'; end if;
  if target.user_id=(select auth.uid()) then raise exception 'cannot change own role' using errcode='42501'; end if;
  if (target.role='admin' or p_role='admin') and actor_role<>'owner' then raise exception 'owner required' using errcode='42501'; end if;
  if target.role='owner' then raise exception 'owner role is managed administratively' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('permission',o.permission_code,'allowed',o.allowed)
    order by o.permission_code),'[]'::jsonb) into old_overrides
   from public.membership_permission_overrides o where o.company_id=p_company_id and o.membership_id=target.id;
  delete from public.membership_permission_overrides where company_id=p_company_id and membership_id=target.id;
  update public.company_memberships set role=p_role where id=target.id;
  if target.role='supervisor' and p_role<>'supervisor' then
    update private.device_authorization_requests set status=case when status='pending' then 'rejected' else 'revoked' end,
      reviewed_at=coalesce(reviewed_at,clock_timestamp()),reviewed_by=coalesce(reviewed_by,(select auth.uid()))
     where company_id=p_company_id and membership_id=target.id and status in ('pending','approved');
    update public.authorized_devices set active=false,revoked_at=coalesce(revoked_at,clock_timestamp())
     where company_id=p_company_id and membership_id=target.id and active;
    delete from public.supervisor_branches where company_id=p_company_id and membership_id=target.id;
  end if;
  if p_role='supervisor' then insert into public.supervisors(company_id,membership_id)
    values(p_company_id,target.id) on conflict(company_id,membership_id) do nothing; end if;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,before_data,after_data)
   values(p_company_id,(select auth.uid()),'USER_ROLE_CHANGED','company_memberships',target.id,
     jsonb_build_object('role',target.role,'permission_overrides',old_overrides),
     jsonb_build_object('role',p_role,'permission_overrides','[]'::jsonb));
  return true;
end $$;

create or replace function public.deactivate_company_membership(p_company_id uuid,p_membership_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor_role public.company_role; target public.company_memberships%rowtype;
begin
  select m.role into actor_role from public.company_memberships m where m.company_id=p_company_id
    and m.user_id=(select auth.uid()) and m.active;
  if actor_role not in ('owner','admin') or not private.has_company_permission(p_company_id,'company.manage') then
    raise exception 'company access denied' using errcode='42501';
  end if;
  select * into target from public.company_memberships m where m.company_id=p_company_id and m.id=p_membership_id for update;
  if not found then return false; end if;
  if target.user_id=(select auth.uid()) then raise exception 'cannot deactivate own access' using errcode='42501'; end if;
  if target.role in ('owner','admin') and actor_role<>'owner' then raise exception 'owner required' using errcode='42501'; end if;
  update public.company_memberships set active=false where id=target.id;
  if target.role='supervisor' then
    update private.device_authorization_requests set status=case when status='pending' then 'rejected' else 'revoked' end,
      reviewed_at=coalesce(reviewed_at,clock_timestamp()),reviewed_by=coalesce(reviewed_by,(select auth.uid()))
     where company_id=p_company_id and membership_id=target.id and status in ('pending','approved');
    update public.authorized_devices set active=false,revoked_at=coalesce(revoked_at,clock_timestamp())
     where company_id=p_company_id and membership_id=target.id and active;
    delete from public.supervisor_branches where company_id=p_company_id and membership_id=target.id;
  end if;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,before_data,after_data)
   values(p_company_id,(select auth.uid()),'USER_ACCESS_DEACTIVATED','company_memberships',target.id,
     jsonb_build_object('active',true,'role',target.role),jsonb_build_object('active',false,'role',target.role));
  return true;
end $$;

revoke all on function public.list_company_user_access(uuid) from public,anon;
revoke all on function public.create_company_user_invitation(uuid,text,public.company_role,uuid) from public,anon;
revoke all on function public.get_company_user_invitation_for_delivery(uuid,uuid) from public,anon;
revoke all on function public.revoke_company_user_invitation(uuid,uuid) from public,anon;
revoke all on function public.list_my_pending_company_invitations() from public,anon;
revoke all on function public.accept_company_user_invitation(uuid) from public,anon;
revoke all on function public.link_employee_account(uuid,uuid,uuid) from public,anon;
revoke all on function public.change_company_membership_role(uuid,uuid,public.company_role) from public,anon;
revoke all on function public.deactivate_company_membership(uuid,uuid) from public,anon;
grant execute on function public.list_company_user_access(uuid) to authenticated;
grant execute on function public.create_company_user_invitation(uuid,text,public.company_role,uuid) to authenticated;
grant execute on function public.get_company_user_invitation_for_delivery(uuid,uuid) to authenticated;
grant execute on function public.revoke_company_user_invitation(uuid,uuid) to authenticated;
grant execute on function public.list_my_pending_company_invitations() to authenticated;
grant execute on function public.accept_company_user_invitation(uuid) to authenticated;
grant execute on function public.link_employee_account(uuid,uuid,uuid) to authenticated;
grant execute on function public.change_company_membership_role(uuid,uuid,public.company_role) to authenticated;
grant execute on function public.deactivate_company_membership(uuid,uuid) to authenticated;
