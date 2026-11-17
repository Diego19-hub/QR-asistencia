begin;

-- Existing companies remain NULL until an authorized user explicitly completes
-- the classification. Do not infer a taxpayer type from historical RFC data.
alter table public.companies
  add column taxpayer_type text,
  add constraint companies_taxpayer_type_check
    check (taxpayer_type is null or taxpayer_type in ('physical_person_business', 'legal_entity'));

-- The old five-argument RPCs are retained as internal implementation details,
-- but clients must use the typed RPCs below for every new company.
revoke all on function public.create_company_for_current_owner(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.create_first_company_for_current_user(text,text,text,text,text) from public,anon,authenticated;

create or replace function public.create_company_for_current_owner(
  p_taxpayer_type text,
  p_name text,
  p_legal_name text,
  p_rfc text,
  p_address text,
  p_employer_registration_number text
) returns table(company_id uuid,membership_id uuid,company_name text)
language plpgsql security definer set search_path = '' as $$
declare created record; expected_length integer; rfc_pattern text;
begin
  if p_taxpayer_type is null or p_taxpayer_type not in ('physical_person_business','legal_entity') then
    raise exception 'invalid taxpayer type' using errcode='22023';
  end if;
  expected_length := case when p_taxpayer_type='physical_person_business' then 13 else 12 end;
  rfc_pattern := case when p_taxpayer_type='physical_person_business'
    then '^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$' else '^[A-Z&Ñ]{3}[0-9]{6}[A-Z0-9]{3}$' end;
  if pg_catalog.length(pg_catalog.upper(pg_catalog.btrim(p_rfc))) <> expected_length
     or pg_catalog.upper(pg_catalog.btrim(p_rfc)) !~ rfc_pattern then
    raise exception 'invalid company RFC format' using errcode='22023';
  end if;
  select * into created from public.create_company_for_current_owner(
    p_name,p_legal_name,p_rfc,p_address,p_employer_registration_number
  );
  update public.companies set taxpayer_type=p_taxpayer_type
    where id=created.company_id and taxpayer_type is null;
  return query select created.company_id,created.membership_id,created.company_name;
end;
$$;
revoke all on function public.create_company_for_current_owner(text,text,text,text,text,text) from public,anon;
grant execute on function public.create_company_for_current_owner(text,text,text,text,text,text) to authenticated;

create or replace function public.create_first_company_for_current_user(
  p_taxpayer_type text,
  p_name text,
  p_legal_name text,
  p_rfc text,
  p_address text,
  p_employer_registration_number text
) returns table(company_id uuid,membership_id uuid,company_name text)
language plpgsql security definer set search_path = '' as $$
declare created record; expected_length integer; rfc_pattern text;
begin
  if p_taxpayer_type is null or p_taxpayer_type not in ('physical_person_business','legal_entity') then
    raise exception 'invalid taxpayer type' using errcode='22023';
  end if;
  expected_length := case when p_taxpayer_type='physical_person_business' then 13 else 12 end;
  rfc_pattern := case when p_taxpayer_type='physical_person_business'
    then '^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$' else '^[A-Z&Ñ]{3}[0-9]{6}[A-Z0-9]{3}$' end;
  if pg_catalog.length(pg_catalog.upper(pg_catalog.btrim(p_rfc))) <> expected_length
     or pg_catalog.upper(pg_catalog.btrim(p_rfc)) !~ rfc_pattern then
    raise exception 'invalid company RFC format' using errcode='22023';
  end if;
  select * into created from public.create_first_company_for_current_user(
    p_name,p_legal_name,p_rfc,p_address,p_employer_registration_number
  );
  update public.companies set taxpayer_type=p_taxpayer_type
    where id=created.company_id and taxpayer_type is null;
  return query select created.company_id,created.membership_id,created.company_name;
end;
$$;
revoke all on function public.create_first_company_for_current_user(text,text,text,text,text,text) from public,anon;
grant execute on function public.create_first_company_for_current_user(text,text,text,text,text,text) to authenticated;

grant select (taxpayer_type) on public.companies to authenticated;
select pg_catalog.pg_notify('pgrst','reload schema');
commit;
