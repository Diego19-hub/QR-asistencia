-- A single database-backed lease serializes report file generation across all
-- Next.js instances and all companies. The table is intentionally private and
-- has no direct Data API grants.
begin;

create table private.report_export_leases (
  lease_key text primary key check (lease_key = 'global'),
  owner_token uuid not null,
  -- Keep these as UUID snapshots without cascading FKs: deleting an Auth user
  -- or company must not erase the global mutex while its request is active.
  company_id uuid not null,
  user_id uuid not null,
  acquired_at timestamptz not null,
  renewed_at timestamptz not null,
  expires_at timestamptz not null,
  constraint report_export_lease_expiry_check check (expires_at > acquired_at)
);

alter table private.report_export_leases enable row level security;
revoke all on table private.report_export_leases from public, anon, authenticated, service_role;

create or replace function public.acquire_report_export_lease(
  p_company_id uuid,
  p_owner_token uuid,
  p_lease_seconds integer default 120
)
returns table (acquired boolean, retry_after_seconds integer, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  acquired_expiry timestamptz;
  occupied_expiry timestamptz;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_owner_token is null or p_company_id is null or p_lease_seconds is null
     or p_lease_seconds < 60 or p_lease_seconds > 300 then
    raise exception 'invalid export lease request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = current_user_id
      and m.active and m.role in ('owner', 'admin')
  ) or not private.has_company_permission(p_company_id, 'reports.read') then
    raise exception 'report export permission denied' using errcode = '42501';
  end if;

  insert into private.report_export_leases as leases (
    lease_key, owner_token, company_id, user_id, acquired_at, renewed_at, expires_at
  ) values (
    'global', p_owner_token, p_company_id, current_user_id,
    clock_timestamp(), clock_timestamp(), clock_timestamp() + make_interval(secs => p_lease_seconds)
  )
  on conflict (lease_key) do update set
    owner_token = excluded.owner_token,
    company_id = excluded.company_id,
    user_id = excluded.user_id,
    acquired_at = clock_timestamp(),
    renewed_at = clock_timestamp(),
    expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  where leases.expires_at <= clock_timestamp()
  returning leases.expires_at into acquired_expiry;

  if acquired_expiry is not null then
    return query select true, 0, acquired_expiry;
    return;
  end if;

  select leases.expires_at into occupied_expiry
  from private.report_export_leases leases where leases.lease_key = 'global';
  return query select false,
    greatest(1, ceil(extract(epoch from (occupied_expiry - clock_timestamp())))::integer),
    occupied_expiry;
end;
$$;

create or replace function public.renew_report_export_lease(
  p_company_id uuid,
  p_owner_token uuid,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_owner_token is null or p_company_id is null or p_lease_seconds is null
     or p_lease_seconds < 60 or p_lease_seconds > 300 then
    raise exception 'invalid export lease request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company_id and m.user_id = current_user_id
      and m.active and m.role in ('owner', 'admin')
  ) or not private.has_company_permission(p_company_id, 'reports.read') then
    raise exception 'report export permission denied' using errcode = '42501';
  end if;

  update private.report_export_leases leases
  set renewed_at = clock_timestamp(),
      expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  where leases.lease_key = 'global' and leases.owner_token = p_owner_token
    and leases.company_id = p_company_id and leases.user_id = current_user_id
    and leases.expires_at > clock_timestamp();
  return found;
end;
$$;

create or replace function public.release_report_export_lease(
  p_company_id uuid,
  p_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_owner_token is null or p_company_id is null then
    raise exception 'invalid export lease request' using errcode = '22023';
  end if;
  -- Releasing does not reveal data or create a lease. The unguessable owner
  -- token, authenticated UID, and company must all match, so a request whose
  -- membership was revoked during generation can still free its own slot.
  delete from private.report_export_leases leases
  where leases.lease_key = 'global' and leases.owner_token = p_owner_token
    and leases.company_id = p_company_id and leases.user_id = current_user_id;
  return found;
end;
$$;

revoke all on function public.acquire_report_export_lease(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.renew_report_export_lease(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.release_report_export_lease(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.acquire_report_export_lease(uuid, uuid, integer) to authenticated;
grant execute on function public.renew_report_export_lease(uuid, uuid, integer) to authenticated;
grant execute on function public.release_report_export_lease(uuid, uuid) to authenticated;

comment on table private.report_export_leases is
  'Single global lease serializing XLSX/PDF generation across all application instances and companies.';

commit;
