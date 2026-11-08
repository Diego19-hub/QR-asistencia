-- Allow an active owner to create another company for their own authenticated
-- identity. The transaction-local marker is set only by the guarded RPC below.
create or replace function private.guard_company_membership_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.company_id<>old.company_id or new.user_id<>old.user_id) then
    raise exception 'membership identity cannot be reassigned' using errcode='23514';
  end if;
  if tg_op='INSERT' and new.role='owner' and (select auth.role()) is distinct from 'service_role' then
    if new.user_id=(select auth.uid())
       and pg_catalog.current_setting('qr_asistencia.create_company_owner',true)=(select auth.uid())::text then
      return new;
    end if;
    if new.user_id=(select auth.uid()) or not private.is_company_owner(new.company_id) then
      raise exception 'only an existing owner may assign owner to another user' using errcode='42501';
    end if;
  end if;
  if tg_op='UPDATE' and new.role='owner' and old.role<>'owner' then
    if new.user_id=(select auth.uid()) or not private.is_company_owner(new.company_id) then
      raise exception 'only an existing owner may assign owner to another user' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then
    if old.role='owner' and old.active and not exists(select 1 from public.company_memberships m
       where m.company_id=old.company_id and m.id<>old.id and m.role='owner' and m.active) then
      raise exception 'cannot remove the last active owner' using errcode='23514';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.role='owner' and old.active and (new.role<>'owner' or not new.active)
     and not exists(select 1 from public.company_memberships m
       where m.company_id=old.company_id and m.id<>old.id and m.role='owner' and m.active) then
    raise exception 'cannot deactivate the last active owner' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_company_membership_owner() from public,anon,authenticated;

create or replace function public.create_company_for_current_owner(
  p_name text,p_legal_name text default null,p_rfc text default null
) returns table(company_id uuid,membership_id uuid,company_name text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid; normalized_name text; normalized_legal text; normalized_rfc text;
  new_company uuid; new_membership uuid;
begin
  actor:=(select auth.uid());
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if (select auth.role()) is distinct from 'authenticated'
     or not exists(select 1 from public.company_memberships m where m.user_id=actor and m.active and m.role='owner') then
    raise exception 'active owner membership required' using errcode='42501';
  end if;
  normalized_name:=nullif(pg_catalog.btrim(p_name),'');
  normalized_legal:=nullif(pg_catalog.btrim(p_legal_name),'');
  normalized_rfc:=nullif(pg_catalog.upper(pg_catalog.btrim(p_rfc)),'');
  if normalized_name is null or pg_catalog.length(normalized_name)>180
     or pg_catalog.length(normalized_legal)>240
     or (normalized_rfc is not null and normalized_rfc !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$') then
    raise exception 'invalid company details' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
  perform pg_catalog.set_config('qr_asistencia.create_company_owner',actor::text,true);
  insert into public.companies(name,legal_name,rfc)
    values(normalized_name,normalized_legal,normalized_rfc) returning id into new_company;
  insert into public.company_memberships(company_id,user_id,role,active)
    values(new_company,actor,'owner',true) returning id into new_membership;
  return query select new_company,new_membership,normalized_name;
end $$;
revoke all on function public.create_company_for_current_owner(text,text,text) from public,anon;
grant execute on function public.create_company_for_current_owner(text,text,text) to authenticated;
select pg_catalog.pg_notify('pgrst','reload schema');
