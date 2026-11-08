-- Company rows use their own `id` as the tenant identifier. The shared audit
-- trigger normally reads `company_id`, so include this explicit fallback and
-- attach the existing audit writer to company profile mutations.
create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  oldj jsonb;
  newj jsonb;
  company uuid;
  entity uuid;
begin
  if tg_op <> 'INSERT' then oldj := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then newj := to_jsonb(new); end if;

  if tg_table_schema = 'public' and tg_table_name = 'companies' then
    company := coalesce((newj->>'id')::uuid, (oldj->>'id')::uuid);
  else
    company := coalesce((newj->>'company_id')::uuid, (oldj->>'company_id')::uuid);
  end if;
  entity := coalesce((newj->>'id')::uuid, (oldj->>'id')::uuid);

  insert into public.audit_log(company_id, actor_user_id, action, entity_table, entity_id, before_data, after_data)
  values (company, (select auth.uid()), tg_op, tg_table_name, entity, oldj, newj);
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_companies on public.companies;
create trigger audit_companies
after insert or update or delete on public.companies
for each row execute function private.write_audit_log();
