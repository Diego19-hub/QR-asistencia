begin;

create table private.company_sensitive_data (
  company_id uuid primary key references public.companies(id) on delete cascade,
  address text,
  rfc text,
  employer_registration_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.employee_sensitive_data (
  company_id uuid not null,
  employee_id uuid not null,
  nss text,
  personal_rfc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, employee_id),
  foreign key (company_id, employee_id)
    references public.employees(company_id, id) on delete cascade
);

revoke all on private.company_sensitive_data, private.employee_sensitive_data from public, anon, authenticated;

-- Preserve existing RFCs in the private table, then remove them from the
-- generally readable companies row without generating a PII-bearing audit row.
insert into private.company_sensitive_data(company_id, rfc)
select c.id, pg_catalog.upper(pg_catalog.btrim(c.rfc))
from public.companies c
where c.rfc is not null
on conflict (company_id) do update set rfc = excluded.rfc;

-- Preserve the existing one-company-per-RFC invariant after moving RFCs out
-- of the broadly readable companies row. A normalization collision aborts
-- this transaction instead of silently assigning one RFC to two companies.
create unique index company_sensitive_data_rfc_unique
  on private.company_sensitive_data(rfc) where rfc is not null;

-- Historical company audit rows may have copied the old public RFC column.
-- Remove those values while preserving the rest of each audit entry.
update public.audit_log set
  before_data = case when before_data ? 'rfc' then before_data - 'rfc' else before_data end,
  after_data = case when after_data ? 'rfc' then after_data - 'rfc' else after_data end
where entity_table = 'companies' and (before_data ? 'rfc' or after_data ? 'rfc');

drop trigger if exists audit_companies on public.companies;
update public.companies set rfc = null where rfc is not null;
create trigger audit_companies after insert or update or delete on public.companies
for each row execute function private.write_audit_log();

-- Column-level grants keep company RFC out of normal Data API reads/writes.
revoke select, update on public.companies from authenticated;
grant select (id, name, legal_name, require_employee_pin, created_at, updated_at)
  on public.companies to authenticated;
grant update (name, legal_name, require_employee_pin, updated_at)
  on public.companies to authenticated;

-- Employee creation and profile edits now write private data atomically via RPC.
revoke insert on public.employees from authenticated;
revoke update on public.employees from authenticated;
grant update (employee_number, first_name, last_name, email, branch_id, hired_on, active)
  on public.employees to authenticated;

create or replace function private.write_audit_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare oldj jsonb; newj jsonb; company uuid; entity uuid;
begin
  if tg_op <> 'INSERT' then oldj := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then newj := to_jsonb(new); end if;
  if tg_table_schema = 'public' and tg_table_name = 'companies' then
    company := coalesce((newj->>'id')::uuid, (oldj->>'id')::uuid);
    oldj := oldj - 'rfc';
    newj := newj - 'rfc';
  else
    company := coalesce((newj->>'company_id')::uuid, (oldj->>'company_id')::uuid);
  end if;
  entity := coalesce((newj->>'id')::uuid, (oldj->>'id')::uuid);
  insert into public.audit_log(company_id, actor_user_id, action, entity_table, entity_id, before_data, after_data)
  values (company, (select auth.uid()), tg_op, tg_table_name, entity, oldj, newj);
  return coalesce(new, old);
end;
$$;
revoke all on function private.write_audit_log() from public, anon, authenticated;

create or replace function public.get_company_sensitive_profile(p_company_id uuid)
returns table(address text, rfc text, employer_registration_number text)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select auth.role()) is distinct from 'authenticated'
     or not exists (
       select 1 from public.company_memberships m
       where m.company_id = p_company_id and m.user_id = (select auth.uid())
         and m.active and m.role in ('owner','admin')
     ) or not private.has_company_permission(p_company_id, 'company.manage') then
    raise exception 'company profile access denied' using errcode = '42501';
  end if;
  return query
    select p.address, p.rfc, p.employer_registration_number
    from private.company_sensitive_data p where p.company_id = p_company_id;
  if not found then
    return query select null::text, null::text, null::text;
  end if;
end;
$$;

create or replace function public.update_company_settings(
  p_company_id uuid,
  p_profile jsonb,
  p_require_employee_pin boolean
) returns table(id uuid, name text, legal_name text, address text, rfc text,
                employer_registration_number text, require_employee_pin boolean, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor uuid; old_profile private.company_sensitive_data%rowtype;
  normalized_name text; normalized_legal text; normalized_address text;
  normalized_rfc text; normalized_registration text; current_company public.companies%rowtype;
begin
  actor := (select auth.uid());
  if actor is null or (select auth.role()) is distinct from 'authenticated'
     or not exists (select 1 from public.company_memberships m where m.company_id=p_company_id and m.user_id=actor and m.active and m.role in ('owner','admin'))
     or not private.has_company_permission(p_company_id, 'company.manage') then
    raise exception 'company management permission required' using errcode = '42501';
  end if;
  select c.* into current_company from public.companies c where c.id=p_company_id for update;
  if not found then raise exception 'company not found' using errcode = 'P0002'; end if;
  select p.* into old_profile from private.company_sensitive_data p where p.company_id=p_company_id for update;

  if p_profile is not null then
    if pg_catalog.jsonb_typeof(p_profile) is distinct from 'object'
       or not (p_profile ?& array['name','address','rfc','employerRegistrationNumber']) then
      raise exception 'complete company profile required' using errcode = '22023';
    end if;
    normalized_name := nullif(pg_catalog.btrim(p_profile->>'name'), '');
    normalized_legal := nullif(pg_catalog.btrim(p_profile->>'legalName'), '');
    normalized_address := nullif(pg_catalog.btrim(p_profile->>'address'), '');
    normalized_rfc := pg_catalog.upper(pg_catalog.btrim(p_profile->>'rfc'));
    normalized_registration := nullif(pg_catalog.btrim(p_profile->>'employerRegistrationNumber'), '');
    if normalized_name is null or pg_catalog.length(normalized_name)>180
       or pg_catalog.length(normalized_legal)>240
       or normalized_address is null or pg_catalog.length(normalized_address)>500
       or normalized_rfc !~ '^[A-Z&Ñ]{3}[0-9]{6}[A-Z0-9]{3}$'
       or normalized_registration is null or pg_catalog.length(normalized_registration)>64 then
      raise exception 'invalid company profile' using errcode = '22023';
    end if;
    update public.companies c set name=normalized_name, legal_name=normalized_legal, rfc=null,
      require_employee_pin=coalesce(p_require_employee_pin,c.require_employee_pin), updated_at=now()
      where c.id=p_company_id;
    insert into private.company_sensitive_data(company_id,address,rfc,employer_registration_number,updated_at)
      values(p_company_id,normalized_address,normalized_rfc,normalized_registration,now())
      on conflict(company_id) do update set address=excluded.address,rfc=excluded.rfc,
        employer_registration_number=excluded.employer_registration_number,updated_at=now();
    if old_profile.address is distinct from normalized_address
       or old_profile.rfc is distinct from normalized_rfc
       or old_profile.employer_registration_number is distinct from normalized_registration then
      insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,before_data,after_data)
      values(p_company_id,actor,'UPDATE','company_sensitive_data',p_company_id,'{}'::jsonb,
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'address',case when old_profile.address is distinct from normalized_address then 'updated' end,
          'rfc',case when old_profile.rfc is distinct from normalized_rfc then 'updated' end,
          'employer_registration_number',case when old_profile.employer_registration_number is distinct from normalized_registration then 'updated' end)));
    end if;
  elsif p_require_employee_pin is not null then
    update public.companies c set require_employee_pin=p_require_employee_pin, updated_at=now() where c.id=p_company_id;
  end if;

  return query select c.id,c.name,c.legal_name,p.address,p.rfc,p.employer_registration_number,
    c.require_employee_pin,c.updated_at
    from public.companies c left join private.company_sensitive_data p on p.company_id=c.id where c.id=p_company_id;
end;
$$;

-- Replace legacy creation RPCs with versions that make the required profile a
-- single transaction with company and Owner membership creation. Keep the old
-- signatures as rejecting shims so stale clients cannot create incomplete data.
create or replace function public.create_company_for_current_owner(
  p_name text,p_legal_name text,p_rfc text,p_address text,p_employer_registration_number text
) returns table(company_id uuid,membership_id uuid,company_name text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid; normalized_name text; normalized_legal text; normalized_rfc text;
  normalized_address text; normalized_registration text; new_company uuid; new_membership uuid;
begin
  actor := (select auth.uid());
  if actor is null or (select auth.role()) is distinct from 'authenticated'
     or not exists(select 1 from public.company_memberships m where m.user_id=actor and m.active and m.role='owner') then
    raise exception 'active owner membership required' using errcode='42501';
  end if;
  normalized_name:=nullif(pg_catalog.btrim(p_name),'');
  normalized_legal:=nullif(pg_catalog.btrim(p_legal_name),'');
  normalized_rfc:=pg_catalog.upper(pg_catalog.btrim(p_rfc));
  normalized_address:=nullif(pg_catalog.btrim(p_address),'');
  normalized_registration:=nullif(pg_catalog.btrim(p_employer_registration_number),'');
  if normalized_name is null or pg_catalog.length(normalized_name)>180 or pg_catalog.length(normalized_legal)>240
     or normalized_address is null or pg_catalog.length(normalized_address)>500
     or normalized_rfc !~ '^[A-Z&Ñ]{3}[0-9]{6}[A-Z0-9]{3}$'
     or normalized_registration is null or pg_catalog.length(normalized_registration)>64 then
    raise exception 'invalid company details' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
  perform pg_catalog.set_config('qr_asistencia.create_company_owner',actor::text,true);
  insert into public.companies(name,legal_name,rfc) values(normalized_name,normalized_legal,null) returning id into new_company;
  insert into private.company_sensitive_data(company_id,address,rfc,employer_registration_number)
    values(new_company,normalized_address,normalized_rfc,normalized_registration);
  insert into public.company_memberships(company_id,user_id,role,active) values(new_company,actor,'owner',true) returning id into new_membership;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
    values(new_company,actor,'CREATE','company_sensitive_data',new_company,
      pg_catalog.jsonb_build_object('address',true,'rfc',true,'employer_registration_number',true));
  return query select new_company,new_membership,normalized_name;
end;
$$;
revoke all on function public.create_company_for_current_owner(text,text,text,text,text) from public,anon;
grant execute on function public.create_company_for_current_owner(text,text,text,text,text) to authenticated;

create or replace function public.create_company_for_current_owner(p_name text,p_legal_name text default null,p_rfc text default null)
returns table(company_id uuid,membership_id uuid,company_name text)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select auth.role()) is distinct from 'authenticated'
     or not exists(select 1 from public.company_memberships m where m.user_id=(select auth.uid()) and m.active and m.role='owner') then
    raise exception 'active owner membership required' using errcode='42501';
  end if;
  raise exception 'complete company details required' using errcode='22023';
end $$;
revoke all on function public.create_company_for_current_owner(text,text,text) from public,anon;
grant execute on function public.create_company_for_current_owner(text,text,text) to authenticated;

create or replace function public.create_first_company_for_current_user(
  p_name text,p_legal_name text,p_rfc text,p_address text,p_employer_registration_number text
) returns table(company_id uuid,membership_id uuid,company_name text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid; confirmed_at timestamptz; normalized_name text; normalized_legal text;
  normalized_rfc text; normalized_address text; normalized_registration text; membership_count integer;
  existing_owner public.company_memberships%rowtype; new_company uuid; new_membership uuid;
begin
  actor := (select auth.uid());
  if actor is null or (select auth.role()) is distinct from 'authenticated' then raise exception 'authenticated identity required' using errcode='42501'; end if;
  select u.email_confirmed_at into confirmed_at from auth.users u where u.id=actor;
  if confirmed_at is null then raise exception 'confirmed email required' using errcode='42501'; end if;
  normalized_name:=nullif(pg_catalog.btrim(p_name),''); normalized_legal:=nullif(pg_catalog.btrim(p_legal_name),'');
  normalized_rfc:=pg_catalog.upper(pg_catalog.btrim(p_rfc)); normalized_address:=nullif(pg_catalog.btrim(p_address),'');
  normalized_registration:=nullif(pg_catalog.btrim(p_employer_registration_number),'');
  if normalized_name is null or pg_catalog.length(normalized_name)>180 or pg_catalog.length(normalized_legal)>240
     or normalized_address is null or pg_catalog.length(normalized_address)>500
     or normalized_rfc !~ '^[A-Z&Ñ]{3}[0-9]{6}[A-Z0-9]{3}$'
     or normalized_registration is null or pg_catalog.length(normalized_registration)>64 then
    raise exception 'invalid company details' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
  select count(*)::integer into membership_count from public.company_memberships m where m.user_id=actor;
  if membership_count=1 then
    select m.* into existing_owner from public.company_memberships m where m.user_id=actor and m.active and m.role='owner';
    if found then return query select c.id,existing_owner.id,c.name from public.companies c where c.id=existing_owner.company_id; return; end if;
  end if;
  if membership_count>0 then raise exception 'account already has company access' using errcode='42501'; end if;
  perform pg_catalog.set_config('qr_asistencia.create_company_owner',actor::text,true);
  insert into public.companies(name,legal_name,rfc) values(normalized_name,normalized_legal,null) returning id into new_company;
  insert into private.company_sensitive_data(company_id,address,rfc,employer_registration_number)
    values(new_company,normalized_address,normalized_rfc,normalized_registration);
  insert into public.company_memberships(company_id,user_id,role,active) values(new_company,actor,'owner',true) returning id into new_membership;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
    values(new_company,actor,'CREATE','company_sensitive_data',new_company,
      pg_catalog.jsonb_build_object('address',true,'rfc',true,'employer_registration_number',true));
  return query select new_company,new_membership,normalized_name;
end;
$$;
revoke all on function public.create_first_company_for_current_user(text,text,text,text,text) from public,anon;
grant execute on function public.create_first_company_for_current_user(text,text,text,text,text) to authenticated;
create or replace function public.create_first_company_for_current_user(p_name text,p_legal_name text default null,p_rfc text default null)
returns table(company_id uuid,membership_id uuid,company_name text)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select auth.role()) is distinct from 'authenticated' then
    raise exception 'authenticated identity required' using errcode='42501';
  end if;
  if not exists(select 1 from public.company_memberships m where m.user_id=(select auth.uid()) and m.active and m.role='owner') then
    raise exception 'account cannot create first company' using errcode='42501';
  end if;
  raise exception 'complete company details required' using errcode='22023';
end $$;
revoke all on function public.create_first_company_for_current_user(text,text,text) from public,anon;
grant execute on function public.create_first_company_for_current_user(text,text,text) to authenticated;

create or replace function public.create_employee_with_sensitive_data(p_company_id uuid,p_employee jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid; branch uuid; employee_id uuid; nss_value text; rfc_value text;
begin
  actor:=(select auth.uid());
  if actor is null or (select auth.role()) is distinct from 'authenticated'
     or not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.user_id=actor and m.active and m.role in ('owner','admin'))
     or not private.has_company_permission(p_company_id,'employees.manage') then
    raise exception 'employee management permission required' using errcode='42501';
  end if;
  branch:=nullif(p_employee->>'branch_id','')::uuid; nss_value:=pg_catalog.btrim(p_employee->>'nss');
  rfc_value:=nullif(pg_catalog.upper(pg_catalog.btrim(p_employee->>'personal_rfc')),'');
  if pg_catalog.length(pg_catalog.btrim(p_employee->>'employee_number')) not between 1 and 64
     or pg_catalog.length(pg_catalog.btrim(p_employee->>'first_name')) not between 1 and 100
     or pg_catalog.length(pg_catalog.btrim(p_employee->>'last_name')) not between 1 and 120
     or pg_catalog.length(pg_catalog.btrim(p_employee->>'email')) > 254
     or nss_value !~ '^[0-9]{11}$' or (rfc_value is not null and rfc_value !~ '^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$') then
    raise exception 'invalid employee details' using errcode='22023';
  end if;
  if branch is not null and not exists(select 1 from public.branches b where b.company_id=p_company_id and b.id=branch and b.active) then
    raise exception 'branch not accessible' using errcode='42501';
  end if;
  insert into public.employees(company_id,employee_number,first_name,last_name,email,branch_id,hired_on)
    values(p_company_id,pg_catalog.btrim(p_employee->>'employee_number'),pg_catalog.btrim(p_employee->>'first_name'),
      pg_catalog.btrim(p_employee->>'last_name'),nullif(pg_catalog.btrim(p_employee->>'email'),''),branch,
      nullif(p_employee->>'hired_on','')::date) returning id into employee_id;
  insert into private.employee_sensitive_data(company_id,employee_id,nss,personal_rfc)
    values(p_company_id,employee_id,nss_value,rfc_value);
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
    values(p_company_id,actor,'CREATE','employee_sensitive_data',employee_id,
      pg_catalog.jsonb_build_object('nss',true,'personal_rfc',rfc_value is not null));
  return employee_id;
end;
$$;

create or replace function public.get_employee_sensitive_profile(p_company_id uuid,p_employee_id uuid)
returns table(nss text,personal_rfc text)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select auth.role()) is distinct from 'authenticated'
     or not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin'))
     or not private.has_company_permission(p_company_id,'employees.read') then
    raise exception 'employee sensitive profile access denied' using errcode='42501';
  end if;
  return query select d.nss,d.personal_rfc from private.employee_sensitive_data d
    where d.company_id=p_company_id and d.employee_id=p_employee_id;
end;
$$;

create or replace function public.update_employee_with_sensitive_data(p_company_id uuid,p_employee_id uuid,p_patch jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid; current_employee public.employees%rowtype; branch uuid; nss_value text; rfc_value text;
  old_sensitive private.employee_sensitive_data%rowtype; changed jsonb := '{}'::jsonb;
begin
  actor:=(select auth.uid());
  if actor is null or (select auth.role()) is distinct from 'authenticated'
     or not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.user_id=actor and m.active and m.role in ('owner','admin'))
     or not private.has_company_permission(p_company_id,'employees.manage') then
    raise exception 'employee management permission required' using errcode='42501';
  end if;
  select e.* into current_employee from public.employees e where e.company_id=p_company_id and e.id=p_employee_id for update;
  if not found then raise exception 'employee not found' using errcode='P0002'; end if;
  select d.* into old_sensitive from private.employee_sensitive_data d where d.company_id=p_company_id and d.employee_id=p_employee_id for update;
  branch:=case when p_patch ? 'branch_id' then nullif(p_patch->>'branch_id','')::uuid else current_employee.branch_id end;
  if branch is not null and not exists(select 1 from public.branches b where b.company_id=p_company_id and b.id=branch and b.active) then
    raise exception 'branch not accessible' using errcode='42501';
  end if;
  nss_value:=case when p_patch ? 'nss' then pg_catalog.btrim(p_patch->>'nss') else old_sensitive.nss end;
  rfc_value:=case when p_patch ? 'personal_rfc' then nullif(pg_catalog.upper(pg_catalog.btrim(p_patch->>'personal_rfc')),'') else old_sensitive.personal_rfc end;
  if nss_value is null or nss_value !~ '^[0-9]{11}$' then raise exception 'invalid employee NSS' using errcode='22023'; end if;
  if rfc_value is not null and rfc_value !~ '^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$' then raise exception 'invalid personal RFC' using errcode='22023'; end if;
  if (p_patch ? 'employee_number' and pg_catalog.length(pg_catalog.btrim(p_patch->>'employee_number')) not between 1 and 64)
     or (p_patch ? 'first_name' and pg_catalog.length(pg_catalog.btrim(p_patch->>'first_name')) not between 1 and 100)
     or (p_patch ? 'last_name' and pg_catalog.length(pg_catalog.btrim(p_patch->>'last_name')) not between 1 and 120)
     or (p_patch ? 'email' and pg_catalog.length(pg_catalog.btrim(p_patch->>'email')) > 254) then
    raise exception 'invalid employee details' using errcode='22023';
  end if;
  update public.employees e set
    employee_number=case when p_patch ? 'employee_number' then pg_catalog.btrim(p_patch->>'employee_number') else e.employee_number end,
    first_name=case when p_patch ? 'first_name' then pg_catalog.btrim(p_patch->>'first_name') else e.first_name end,
    last_name=case when p_patch ? 'last_name' then pg_catalog.btrim(p_patch->>'last_name') else e.last_name end,
    email=case when p_patch ? 'email' then nullif(pg_catalog.btrim(p_patch->>'email'),'') else e.email end,
    branch_id=branch,
    hired_on=case when p_patch ? 'hired_on' then nullif(p_patch->>'hired_on','')::date else e.hired_on end,
    active=case when p_patch ? 'active' then (p_patch->>'active')::boolean else e.active end,
    updated_at=now()
    where e.company_id=p_company_id and e.id=p_employee_id;
  insert into private.employee_sensitive_data(company_id,employee_id,nss,personal_rfc,updated_at)
    values(p_company_id,p_employee_id,nss_value,rfc_value,now())
    on conflict(company_id,employee_id) do update set nss=excluded.nss,personal_rfc=excluded.personal_rfc,updated_at=now();
  if old_sensitive.nss is distinct from nss_value then changed:=changed || pg_catalog.jsonb_build_object('nss',true); end if;
  if old_sensitive.personal_rfc is distinct from rfc_value then changed:=changed || pg_catalog.jsonb_build_object('personal_rfc',true); end if;
  if changed <> '{}'::jsonb then
    insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
      values(p_company_id,actor,'UPDATE','employee_sensitive_data',p_employee_id,changed);
  end if;
  return p_employee_id;
end;
$$;

revoke all on function public.get_company_sensitive_profile(uuid) from public,anon;
grant execute on function public.get_company_sensitive_profile(uuid) to authenticated;
revoke all on function public.update_company_settings(uuid,jsonb,boolean) from public,anon;
grant execute on function public.update_company_settings(uuid,jsonb,boolean) to authenticated;
revoke all on function public.create_employee_with_sensitive_data(uuid,jsonb) from public,anon;
grant execute on function public.create_employee_with_sensitive_data(uuid,jsonb) to authenticated;
revoke all on function public.get_employee_sensitive_profile(uuid,uuid) from public,anon;
grant execute on function public.get_employee_sensitive_profile(uuid,uuid) to authenticated;
revoke all on function public.update_employee_with_sensitive_data(uuid,uuid,jsonb) from public,anon;
grant execute on function public.update_employee_with_sensitive_data(uuid,uuid,jsonb) to authenticated;

select pg_catalog.pg_notify('pgrst','reload schema');
commit;
