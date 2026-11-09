-- Allow a confirmed Auth identity with no prior company access to create its
-- first company. The actor and owner membership always come from auth.uid().
-- Company and membership writes share this function transaction; retries for
-- an already-created first company return the same result.
begin;

create or replace function public.create_first_company_for_current_user(
  p_name text,
  p_legal_name text default null,
  p_rfc text default null
) returns table(company_id uuid, membership_id uuid, company_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  confirmed_at timestamptz;
  normalized_name text;
  normalized_legal text;
  normalized_rfc text;
  membership_count integer;
  existing_owner public.company_memberships%rowtype;
  new_company uuid;
  new_membership uuid;
begin
  actor := (select auth.uid());
  if actor is null or (select auth.role()) is distinct from 'authenticated' then
    raise exception 'authenticated identity required' using errcode = '42501';
  end if;

  select u.email_confirmed_at into confirmed_at from auth.users u where u.id = actor;
  if confirmed_at is null then
    raise exception 'confirmed email required' using errcode = '42501';
  end if;

  normalized_name := nullif(pg_catalog.btrim(p_name), '');
  normalized_legal := nullif(pg_catalog.btrim(p_legal_name), '');
  normalized_rfc := nullif(pg_catalog.upper(pg_catalog.btrim(p_rfc)), '');
  if normalized_name is null or pg_catalog.length(normalized_name) > 180
     or pg_catalog.length(normalized_legal) > 240
     or (normalized_rfc is not null and normalized_rfc !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$') then
    raise exception 'invalid company details' using errcode = '22023';
  end if;

  -- Serialize simultaneous onboarding retries for one Auth identity.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
  select count(*)::integer into membership_count
    from public.company_memberships m where m.user_id = actor;

  if membership_count = 1 then
    select m.* into existing_owner from public.company_memberships m
     where m.user_id = actor and m.active and m.role = 'owner';
    if found then
      return query select c.id, existing_owner.id, c.name
        from public.companies c where c.id = existing_owner.company_id;
      return;
    end if;
  end if;
  if membership_count > 0 then
    raise exception 'account already has company access' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('qr_asistencia.create_company_owner', actor::text, true);
  insert into public.companies(name, legal_name, rfc)
    values(normalized_name, normalized_legal, normalized_rfc)
    returning id into new_company;
  insert into public.company_memberships(company_id, user_id, role, active)
    values(new_company, actor, 'owner', true)
    returning id into new_membership;

  return query select new_company, new_membership, normalized_name;
end;
$$;

revoke all on function public.create_first_company_for_current_user(text, text, text) from public, anon;
grant execute on function public.create_first_company_for_current_user(text, text, text) to authenticated;

commit;
