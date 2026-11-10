begin;

-- New companies must have a legal name. Existing rows with a null or blank
-- value remain readable and can still receive unrelated updates; changing the
-- legal_name field requires a nonblank value.
create or replace function private.require_company_legal_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.legal_name is null or pg_catalog.btrim(new.legal_name) = '' then
    raise exception 'company legal name is required' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.require_company_legal_name() from public, anon, authenticated;

create trigger companies_require_legal_name
before insert or update of legal_name on public.companies
for each row execute function private.require_company_legal_name();

commit;
