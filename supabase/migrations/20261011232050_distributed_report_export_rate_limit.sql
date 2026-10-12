-- Shared, atomic fixed-window quota for report exports. The table is never
-- exposed through PostgREST; callers can only use the guarded public RPC.
create table private.report_export_rate_limits (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (company_id, user_id, window_started_at)
);

create index report_export_rate_limits_window_idx
  on private.report_export_rate_limits (window_started_at);

alter table private.report_export_rate_limits enable row level security;
revoke all on private.report_export_rate_limits from public, anon, authenticated;

create or replace function public.consume_report_export_quota(p_company_id uuid)
returns table (allowed boolean, retry_after_seconds integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_window timestamptz := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / 300) * 300
  );
  updated_count integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id = current_user_id
      and m.active
      and m.role in ('owner', 'admin')
  ) or not private.has_company_permission(p_company_id, 'reports.read') then
    raise exception 'report export permission denied' using errcode = '42501';
  end if;

  insert into private.report_export_rate_limits as limits (
    company_id, user_id, window_started_at, request_count
  ) values (p_company_id, current_user_id, current_window, 1)
  on conflict (company_id, user_id, window_started_at)
  do update set request_count = limits.request_count + 1
  returning request_count into updated_count;

  -- Bound storage cleanup work while opportunistically removing old buckets.
  with stale as (
    select ctid from private.report_export_rate_limits
    where window_started_at < clock_timestamp() - interval '1 day'
    order by window_started_at
    limit 500
  )
  delete from private.report_export_rate_limits limits
  using stale
  where limits.ctid = stale.ctid;

  return query select
    updated_count <= 10,
    case when updated_count <= 10 then 0 else greatest(1, ceil(extract(epoch from (current_window + interval '5 minutes' - clock_timestamp())))::integer) end,
    greatest(0, 10 - updated_count);
end;
$$;

revoke all on function public.consume_report_export_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_report_export_quota(uuid) to authenticated;
