-- Require normalized, valid personal RFC on employee creation and every save.
-- Existing records remain readable; no backfill or constraint is applied.
begin;

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
  rfc_value:=pg_catalog.upper(pg_catalog.btrim(p_employee->>'personal_rfc'));
  if pg_catalog.length(pg_catalog.btrim(p_employee->>'employee_number')) not between 1 and 64
     or pg_catalog.length(pg_catalog.btrim(p_employee->>'first_name')) not between 1 and 100
     or pg_catalog.length(pg_catalog.btrim(p_employee->>'last_name')) not between 1 and 120
     or pg_catalog.length(pg_catalog.btrim(p_employee->>'email')) > 254
     or nss_value !~ '^[0-9]{11}$' or rfc_value is null or rfc_value !~ '^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$' then
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
  rfc_value:=case when p_patch ? 'personal_rfc' then pg_catalog.upper(pg_catalog.btrim(p_patch->>'personal_rfc')) else old_sensitive.personal_rfc end;
  if nss_value is null or nss_value !~ '^[0-9]{11}$' then raise exception 'invalid employee NSS' using errcode='22023'; end if;
  if rfc_value is null or rfc_value !~ '^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$' then raise exception 'invalid personal RFC' using errcode='22023'; end if;
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

select pg_catalog.pg_notify('pgrst','reload schema');
commit;
