create or replace function public.accept_company_user_invitation(p_invitation_id uuid)
returns table(company_id uuid,role public.company_role)
language plpgsql security definer set search_path = '' as $$
declare
  invite public.company_user_invitations%rowtype;
  existing public.company_memberships%rowtype;
  inviter public.company_memberships%rowtype;
  actor_id uuid;
  actor_email text;
  actor_invited_at timestamptz;
  setup_completed_at timestamptz;
  setup_completed_value text;
begin
  actor_id:=(select auth.uid());
  select lower(trim(u.email)),u.invited_at,
         nullif(btrim(u.raw_app_meta_data->>'access_setup_completed_at'),'')
    into actor_email,actor_invited_at,setup_completed_value
    from auth.users u
   where u.id=actor_id and u.email_confirmed_at is not null;
  if actor_id is null or actor_email is null or actor_email='' then
    raise exception 'verified email authentication required' using errcode='42501';
  end if;

  -- Auth user_metadata is client-editable. Only the server-owned app_metadata
  -- marker can satisfy the first-login password setup requirement.
  if actor_invited_at is not null then
    begin
      setup_completed_at:=setup_completed_value::timestamptz;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        setup_completed_at:=null;
    end;
    if setup_completed_at is null or not isfinite(setup_completed_at)
       or setup_completed_at>statement_timestamp() then
      raise exception 'invitation acceptance denied' using errcode='42501';
    end if;
  end if;

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
  update public.company_user_invitations i set status='accepted',accepted_at=now(),accepted_by=actor_id,share_token_hash=null
    where i.id=invite.id;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
   values(invite.company_id,actor_id,'USER_INVITATION_ACCEPTED','company_user_invitations',invite.id,
     jsonb_build_object('role',invite.role,'employee_id',invite.employee_id));
  return query select invite.company_id,invite.role;
end $$;
