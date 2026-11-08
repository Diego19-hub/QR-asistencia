-- Optional PIN policy and encrypted employee QR storage are introduced by
-- 20261107211000_optional_employee_pin_requirement.sql and
-- 20261107220000_employee_self_service_qr_display.sql. This final migration
-- removes the recoverable ciphertext when an administrator revokes a QR.
begin;

create or replace function public.revoke_employee_qr_token(p_company_id uuid, p_employee_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare employee_active boolean; changed_at timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  if not private.has_company_permission(p_company_id, 'employees.manage') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.active and m.role in ('owner', 'admin')
  ) then
    raise exception 'admin role required' using errcode='42501';
  end if;

  select e.active into employee_active
  from public.employees e
  where e.company_id = p_company_id and e.id = p_employee_id
  for update;
  if not found then raise exception 'employee not found' using errcode='P0002'; end if;

  update private.employee_qr_tokens
  set revoked_at = clock_timestamp(), encrypted_token = null
  where employee_id = p_employee_id and revoked_at is null
  returning revoked_at into changed_at;
  if changed_at is null then return jsonb_build_object('qrStatus', 'not_active'); end if;

  insert into public.audit_log(company_id, actor_user_id, action, entity_table, entity_id, after_data)
  values (
    p_company_id, (select auth.uid()), 'EMPLOYEE_QR_REVOKED', 'employees', p_employee_id,
    jsonb_build_object('qrStatus', 'revoked', 'revokedAt', changed_at)
  );
  return jsonb_build_object('qrStatus', 'revoked', 'revokedAt', changed_at);
end;
$$;

revoke all on function public.revoke_employee_qr_token(uuid, uuid) from public, anon;
grant execute on function public.revoke_employee_qr_token(uuid, uuid) to authenticated;

select pg_catalog.pg_notify('pgrst', 'reload schema');
commit;
