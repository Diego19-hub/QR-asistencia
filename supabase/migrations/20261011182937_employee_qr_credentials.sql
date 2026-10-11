-- Credentials for employee QR codes and optional employee PINs.
-- QR values are SHA-256 hashes only. Raw tokens are returned once to the caller.

create table private.employee_pin_credentials (
  company_id uuid not null,
  employee_id uuid not null,
  pin_hash text not null,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, employee_id),
  foreign key (company_id, employee_id)
    references public.employees(company_id, id) on delete cascade
);

alter table private.employee_qr_tokens enable row level security;
alter table private.employee_pin_credentials enable row level security;
revoke all on private.employee_qr_tokens, private.employee_pin_credentials from public, anon, authenticated, service_role;

create or replace function public.get_employee_credential_status(p_company_id uuid, p_employee_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare employee_active boolean; qr private.employee_qr_tokens%rowtype; has_pin boolean;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not private.has_company_permission(p_company_id, 'employees.manage') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id
      and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin')) then
    raise exception 'admin role required' using errcode='42501';
  end if;
  select e.active into employee_active from public.employees e
   where e.company_id=p_company_id and e.id=p_employee_id;
  if not found then raise exception 'employee not found' using errcode='P0002'; end if;
  select q.* into qr from private.employee_qr_tokens q where q.employee_id=p_employee_id;
  select exists(select 1 from private.employee_pin_credentials p
    where p.company_id=p_company_id and p.employee_id=p_employee_id) into has_pin;
  return jsonb_build_object(
    'employeeActive', employee_active,
    'qrStatus', case when qr.employee_id is null then 'not_issued'
      when qr.revoked_at is null then 'active' else 'revoked' end,
    'issuedAt', qr.issued_at,
    'revokedAt', qr.revoked_at,
    'pinConfigured', has_pin
  );
end $$;

create or replace function public.issue_employee_qr_token(
  p_company_id uuid, p_employee_id uuid, p_token_hash_hex text, p_replace boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare employee_active boolean; current_qr private.employee_qr_tokens%rowtype; changed_at timestamptz; was_active boolean; recent_issues integer;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not private.has_company_permission(p_company_id, 'employees.manage') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id
      and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin')) then
    raise exception 'admin role required' using errcode='42501';
  end if;
  if p_token_hash_hex is null or p_token_hash_hex !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'invalid token hash' using errcode='22023';
  end if;
  select e.active into employee_active from public.employees e
   where e.company_id=p_company_id and e.id=p_employee_id for update;
  if not found then raise exception 'employee not found' using errcode='P0002'; end if;
  if not employee_active then raise exception 'employee is inactive' using errcode='23514'; end if;
  select q.* into current_qr from private.employee_qr_tokens q where q.employee_id=p_employee_id for update;
  was_active := found and current_qr.revoked_at is null;
  if was_active and not p_replace then
    raise exception 'active QR credential already exists' using errcode='23505';
  end if;
  select count(*)::integer into recent_issues from public.audit_log a
   where a.company_id=p_company_id and a.entity_table='employees' and a.entity_id=p_employee_id
     and a.action in ('EMPLOYEE_QR_ISSUED','EMPLOYEE_QR_REGENERATED')
     and a.occurred_at > clock_timestamp() - interval '1 hour';
  if recent_issues >= 5 then
    raise exception 'QR issuance rate limit exceeded' using errcode='P0001';
  end if;
  changed_at := clock_timestamp();
  insert into private.employee_qr_tokens(employee_id, token_hash, issued_at, revoked_at)
    values (p_employee_id, decode(p_token_hash_hex,'hex'), changed_at, null)
    on conflict (employee_id) do update set token_hash=excluded.token_hash,
      issued_at=excluded.issued_at, revoked_at=null;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
    values (p_company_id,(select auth.uid()),
      case when was_active then 'EMPLOYEE_QR_REGENERATED' else 'EMPLOYEE_QR_ISSUED' end,
      'employees',p_employee_id,jsonb_build_object('qrStatus','active','issuedAt',changed_at));
  return jsonb_build_object('qrStatus','active','issuedAt',changed_at);
end $$;

create or replace function public.revoke_employee_qr_token(p_company_id uuid, p_employee_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare employee_active boolean; changed_at timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not private.has_company_permission(p_company_id, 'employees.manage') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id
      and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin')) then
    raise exception 'admin role required' using errcode='42501';
  end if;
  select e.active into employee_active from public.employees e
   where e.company_id=p_company_id and e.id=p_employee_id for update;
  if not found then raise exception 'employee not found' using errcode='P0002'; end if;
  update private.employee_qr_tokens set revoked_at=clock_timestamp()
   where employee_id=p_employee_id and revoked_at is null returning revoked_at into changed_at;
  if changed_at is null then return jsonb_build_object('qrStatus','not_active'); end if;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
    values (p_company_id,(select auth.uid()),'EMPLOYEE_QR_REVOKED','employees',p_employee_id,
      jsonb_build_object('qrStatus','revoked','revokedAt',changed_at));
  return jsonb_build_object('qrStatus','revoked','revokedAt',changed_at);
end $$;

create or replace function public.set_employee_pin(p_company_id uuid, p_employee_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare employee_active boolean; was_configured boolean; changed_at timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not private.has_company_permission(p_company_id, 'employees.manage') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id
      and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin')) then
    raise exception 'admin role required' using errcode='42501';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6,12}$' then
    raise exception 'PIN must contain 6 to 12 digits' using errcode='22023';
  end if;
  select e.active into employee_active from public.employees e
   where e.company_id=p_company_id and e.id=p_employee_id for update;
  if not found then raise exception 'employee not found' using errcode='P0002'; end if;
  if not employee_active then raise exception 'employee is inactive' using errcode='23514'; end if;
  select exists(select 1 from private.employee_pin_credentials p
    where p.company_id=p_company_id and p.employee_id=p_employee_id) into was_configured;
  changed_at := clock_timestamp();
  insert into private.employee_pin_credentials(company_id,employee_id,pin_hash,failed_attempts,locked_until,updated_at)
    values(p_company_id,p_employee_id,extensions.crypt(p_pin,extensions.gen_salt('bf',12)),0,null,changed_at)
    on conflict(company_id,employee_id) do update set pin_hash=excluded.pin_hash,
      failed_attempts=0,locked_until=null,updated_at=excluded.updated_at;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
    values(p_company_id,(select auth.uid()),case when was_configured then 'EMPLOYEE_PIN_RESET' else 'EMPLOYEE_PIN_SET' end,
      'employees',p_employee_id,jsonb_build_object('pinConfigured',true,'updatedAt',changed_at));
  return jsonb_build_object('pinConfigured',true,'updatedAt',changed_at);
end $$;

-- Intended only for a future trusted attendance RPC. It is deliberately not executable
-- by API roles; scanning is not enabled by this migration.
create or replace function private.verify_employee_pin(p_company_id uuid, p_employee_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare credential private.employee_pin_credentials%rowtype; employee_active boolean; now_at timestamptz;
begin
  now_at := clock_timestamp();
  select e.active into employee_active from public.employees e
   where e.company_id=p_company_id and e.id=p_employee_id;
  if not found or not employee_active then return jsonb_build_object('valid',false,'status','unavailable'); end if;
  select p.* into credential from private.employee_pin_credentials p
   where p.company_id=p_company_id and p.employee_id=p_employee_id for update;
  if not found then return jsonb_build_object('valid',false,'status','not_configured'); end if;
  if credential.locked_until is not null and credential.locked_until > now_at then
    return jsonb_build_object('valid',false,'status','locked','lockedUntil',credential.locked_until);
  end if;
  if p_pin is not null and p_pin ~ '^[0-9]{6,12}$'
     and extensions.crypt(p_pin,credential.pin_hash)=credential.pin_hash then
    update private.employee_pin_credentials set failed_attempts=0,locked_until=null,updated_at=now_at
     where company_id=p_company_id and employee_id=p_employee_id;
    return jsonb_build_object('valid',true,'status','valid');
  end if;
  update private.employee_pin_credentials set
    failed_attempts=case when locked_until is not null and locked_until <= now_at then 1 else least(failed_attempts+1,5) end,
    locked_until=case when (case when locked_until is not null and locked_until <= now_at then 1 else failed_attempts+1 end) >= 5
      then now_at + interval '15 minutes' else null end,
    updated_at=now_at
   where company_id=p_company_id and employee_id=p_employee_id returning * into credential;
  return jsonb_build_object('valid',false,
    'status',case when credential.locked_until is not null and credential.locked_until > now_at then 'locked' else 'invalid' end,
    'lockedUntil',credential.locked_until);
end $$;

revoke all on function public.get_employee_credential_status(uuid,uuid) from public,anon;
revoke all on function public.issue_employee_qr_token(uuid,uuid,text,boolean) from public,anon;
revoke all on function public.revoke_employee_qr_token(uuid,uuid) from public,anon;
revoke all on function public.set_employee_pin(uuid,uuid,text) from public,anon;
grant execute on function public.get_employee_credential_status(uuid,uuid) to authenticated;
grant execute on function public.issue_employee_qr_token(uuid,uuid,text,boolean) to authenticated;
grant execute on function public.revoke_employee_qr_token(uuid,uuid) to authenticated;
grant execute on function public.set_employee_pin(uuid,uuid,text) to authenticated;
revoke all on function private.verify_employee_pin(uuid,uuid,text) from public,anon,authenticated,service_role;

comment on table private.employee_pin_credentials is 'Bcrypt PIN hashes only; raw PINs are never persisted. Trusted verification helper enforces a 5-attempt, 15-minute lockout.';
