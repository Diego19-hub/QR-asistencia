-- First-company bootstrap is an administrative operation. The public wrapper
-- is executable only by the server-side service_role, never by browser users.
create table private.bootstrap_requests (
 request_id uuid primary key,
 company_id uuid not null unique references public.companies(id) on delete restrict,
 owner_user_id uuid not null references auth.users(id) on delete restrict,
 company_name text not null,
 legal_name text,
 rfc text,
 created_at timestamptz not null default now()
);
revoke all on private.bootstrap_requests from public,anon,authenticated,service_role;
grant usage on schema private to service_role;

create or replace function private.is_company_owner(p_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.company_memberships m
  where m.company_id=p_company_id and m.user_id=(select auth.uid())
   and m.role='owner' and m.active)
$$;
revoke all on function private.is_company_owner(uuid) from public,anon;
grant execute on function private.is_company_owner(uuid) to authenticated;

create or replace function private.guard_company_membership_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='UPDATE' and (new.company_id<>old.company_id or new.user_id<>old.user_id) then
  raise exception 'membership identity cannot be reassigned' using errcode='23514';
 end if;
 if tg_op='INSERT' and new.role='owner' and (select auth.role()) is distinct from 'service_role' then
  if new.user_id=(select auth.uid()) or not private.is_company_owner(new.company_id) then
   raise exception 'only an existing owner may assign owner to another user' using errcode='42501';
  end if;
 end if;
 if tg_op='UPDATE' and new.role='owner' and old.role<>'owner' then
  if new.user_id=(select auth.uid()) or not private.is_company_owner(new.company_id) then
   raise exception 'only an existing owner may assign owner to another user' using errcode='42501';
  end if;
 end if;
 if tg_op='DELETE' and old.role='owner' and old.active and not exists(
   select 1 from public.company_memberships m where m.company_id=old.company_id
    and m.id<>old.id and m.role='owner' and m.active) then
  raise exception 'cannot remove the last active owner' using errcode='23514';
 end if;
 if tg_op='UPDATE' and old.role='owner' and old.active and (new.role<>'owner' or not new.active) and not exists(
   select 1 from public.company_memberships m where m.company_id=old.company_id
    and m.id<>old.id and m.role='owner' and m.active) then
  raise exception 'cannot deactivate the last active owner' using errcode='23514';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function private.guard_company_membership_owner() from public,anon,authenticated;
create trigger company_membership_owner_guard before insert or update or delete on public.company_memberships
 for each row execute function private.guard_company_membership_owner();

create or replace function private.bootstrap_first_company(
 p_request_id uuid,p_owner_user_id uuid,p_company_name text,
 p_legal_name text default null,p_rfc text default null
) returns table(company_id uuid,owner_user_id uuid,role public.company_role)
language plpgsql security definer set search_path = '' as $$
declare existing private.bootstrap_requests%rowtype; new_company_id uuid; normalized_name text;
begin
 if (select auth.role()) is distinct from 'service_role' then
  raise exception 'administrative service role required' using errcode='42501';
 end if;
 normalized_name:=nullif(trim(p_company_name),'');
 if p_request_id is null or p_owner_user_id is null or normalized_name is null then
  raise exception 'request id, owner user and company name are required' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('asistencia-qr:initial-company',0));
 select * into existing from private.bootstrap_requests b where b.request_id=p_request_id for update;
 if found then
  if existing.owner_user_id<>p_owner_user_id or existing.company_name<>normalized_name or
     existing.legal_name is distinct from nullif(trim(p_legal_name),'') or
     existing.rfc is distinct from nullif(upper(trim(p_rfc)),'') then
   raise exception 'idempotency key already used with different bootstrap data' using errcode='22023';
  end if;
  return query select existing.company_id,existing.owner_user_id,'owner'::public.company_role;
  return;
 end if;
 if exists(select 1 from public.companies) then
  raise exception 'initial company already exists; bootstrap is closed' using errcode='23505';
 end if;
 if not exists(select 1 from auth.users u where u.id=p_owner_user_id) then
  raise exception 'owner must be an existing Supabase Auth user' using errcode='23503';
 end if;
 insert into public.companies(name,legal_name,rfc)
 values(normalized_name,nullif(trim(p_legal_name),''),nullif(upper(trim(p_rfc)),''))
 returning id into new_company_id;
 insert into public.company_memberships(company_id,user_id,role,active)
 values(new_company_id,p_owner_user_id,'owner',true);
 insert into private.bootstrap_requests(request_id,company_id,owner_user_id,company_name,legal_name,rfc)
 values(p_request_id,new_company_id,p_owner_user_id,normalized_name,
        nullif(trim(p_legal_name),''),nullif(upper(trim(p_rfc)),''));
 return query select new_company_id,p_owner_user_id,'owner'::public.company_role;
end $$;
revoke all on function private.bootstrap_first_company(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.bootstrap_first_company(uuid,uuid,text,text,text) to service_role;
create or replace function public.bootstrap_first_company(
 p_request_id uuid,p_owner_user_id uuid,p_company_name text,
 p_legal_name text default null,p_rfc text default null
) returns table(company_id uuid,owner_user_id uuid,role public.company_role)
language sql security invoker set search_path = '' as $$
 select * from private.bootstrap_first_company(p_request_id,p_owner_user_id,p_company_name,p_legal_name,p_rfc)
$$;
revoke all on function public.bootstrap_first_company(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.bootstrap_first_company(uuid,uuid,text,text,text) to service_role;

-- Any active company member may resolve their tenant name and membership role.
drop policy company_tenant_select on public.companies;
create policy company_tenant_select on public.companies for select to authenticated using (
 private.has_company_permission(id,'company.read') or exists(
  select 1 from public.company_memberships m where m.company_id=companies.id
   and m.user_id=(select auth.uid()) and m.active));

-- Corrections are approved/rejected as separate records. This function only
-- updates the request review state; the original attendance_events stay immutable.
alter table public.attendance_adjustments add column review_note text;
create or replace function private.review_attendance_adjustment(
 p_adjustment_id uuid,p_approve boolean,p_review_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare item public.attendance_adjustments%rowtype;
begin
 if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
 select * into item from public.attendance_adjustments a where a.id=p_adjustment_id for update;
 if not found then raise exception 'adjustment not found' using errcode='P0002'; end if;
 if not private.has_company_permission(item.company_id,'attendance.review_adjustments') then
  raise exception 'permission denied' using errcode='42501';
 end if;
 if item.requested_by=(select auth.uid()) then
  raise exception 'requester cannot review their own adjustment' using errcode='42501';
 end if;
 if item.status<>'pending' then raise exception 'adjustment is already resolved' using errcode='23514'; end if;
 update public.attendance_adjustments set
  status=case when p_approve then 'approved' else 'rejected' end,
  reviewed_by=(select auth.uid()),reviewed_at=clock_timestamp(),
  review_note=nullif(trim(p_review_note),'')
 where id=p_adjustment_id;
 return p_adjustment_id;
end $$;
revoke all on function private.review_attendance_adjustment(uuid,boolean,text) from public,anon,authenticated;
grant execute on function private.review_attendance_adjustment(uuid,boolean,text) to authenticated;
create or replace function public.review_attendance_adjustment(
 p_adjustment_id uuid,p_approve boolean,p_review_note text default null
) returns uuid language sql security invoker set search_path = '' as $$
 select private.review_attendance_adjustment(p_adjustment_id,p_approve,p_review_note)
$$;
revoke all on function public.review_attendance_adjustment(uuid,boolean,text) from public,anon;
grant execute on function public.review_attendance_adjustment(uuid,boolean,text) to authenticated;
