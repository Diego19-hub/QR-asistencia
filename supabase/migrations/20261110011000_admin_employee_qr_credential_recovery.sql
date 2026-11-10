-- Allow an authorized company administrator to recover an existing active QR.
-- The encrypted envelope is returned only to the authenticated server route;
-- the route decrypts it and responds with no-store headers. This function never
-- issues, replaces, revokes, or audits a credential.
create or replace function public.get_employee_qr_credential_envelope(
  p_company_id uuid,
  p_employee_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  employee_is_active boolean;
  issued_at_value timestamptz;
  revoked_at_value timestamptz;
  encrypted_token_value text;
begin
  if (select auth.uid()) is null
     or (select auth.role()) is distinct from 'authenticated' then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.has_company_permission(p_company_id, 'employees.manage')
     or not exists (
       select 1
         from public.company_memberships m
        where m.company_id = p_company_id
          and m.user_id = (select auth.uid())
          and m.active
          and m.role in ('owner', 'admin')
     ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select e.active
    into employee_is_active
    from public.employees e
   where e.company_id = p_company_id
     and e.id = p_employee_id;
  if not found then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  if not employee_is_active then
    raise exception 'employee is inactive' using errcode = '23514';
  end if;

  select q.issued_at, q.revoked_at, q.encrypted_token
    into issued_at_value, revoked_at_value, encrypted_token_value
    from private.employee_qr_tokens q
   where q.employee_id = p_employee_id;
  if not found then
    return jsonb_build_object(
      'qrStatus', 'not_issued',
      'issuedAt', null,
      'revokedAt', null,
      'encryptedToken', null
    );
  end if;

  return jsonb_build_object(
    'qrStatus', case when revoked_at_value is null then 'active' else 'revoked' end,
    'issuedAt', issued_at_value,
    'revokedAt', revoked_at_value,
    'encryptedToken', case when revoked_at_value is null then encrypted_token_value else null end
  );
end;
$$;

revoke all on function public.get_employee_qr_credential_envelope(uuid, uuid) from public, anon;
grant execute on function public.get_employee_qr_credential_envelope(uuid, uuid) to authenticated;

comment on function public.get_employee_qr_credential_envelope(uuid, uuid) is
  'Read-only active employee QR envelope for the authorized company server route; never returns the digest or plaintext token.';

select pg_notify('pgrst', 'reload schema');
