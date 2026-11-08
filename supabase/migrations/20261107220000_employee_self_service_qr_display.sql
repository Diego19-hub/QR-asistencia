-- Preserve employee QR tokens only as authenticated ciphertext so the linked
-- employee can display the active credential without storing plaintext.
alter table private.employee_qr_tokens
  add column encrypted_token text;

comment on column private.employee_qr_tokens.encrypted_token is
  'AES-256-GCM envelope encrypted by the application; nullable for credentials issued before employee self-display was introduced.';

create or replace function public.issue_employee_qr_token_with_ciphertext(
  p_company_id uuid,
  p_employee_id uuid,
  p_token_hash_hex text,
  p_encrypted_token text,
  p_replace boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_encrypted_token is null
     or length(p_encrypted_token) > 2048
     or p_encrypted_token !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
    raise exception 'invalid encrypted credential' using errcode = '22023';
  end if;

  -- Reuse the established permission, active-employee, rate-limit, locking,
  -- replacement invalidation and audit checks. Both writes share this RPC's
  -- transaction, so the new token is never active without its ciphertext.
  result := public.issue_employee_qr_token(p_company_id, p_employee_id, p_token_hash_hex, p_replace);
  update private.employee_qr_tokens
     set encrypted_token = p_encrypted_token
   where employee_id = p_employee_id
     and token_hash = decode(p_token_hash_hex, 'hex')
     and revoked_at is null;
  if not found then
    raise exception 'credential update failed' using errcode = 'P0001';
  end if;
  return result;
end;
$$;

create or replace function public.get_own_employee_credential_status(
  p_company_id uuid,
  p_employee_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare issued_at_value timestamptz; revoked_at_value timestamptz; encrypted_token_value text;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.company_memberships m
    join public.employees e on e.company_id = m.company_id
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.active and m.role = 'employee'
      and e.id = p_employee_id
      and e.auth_user_id = (select auth.uid())
      and e.active
  ) then
    raise exception 'employee profile unavailable' using errcode = '42501';
  end if;

  select q.issued_at, q.revoked_at, q.encrypted_token
    into issued_at_value, revoked_at_value, encrypted_token_value
    from private.employee_qr_tokens q
   where q.employee_id = p_employee_id;
  if not found then
    return jsonb_build_object('status', 'not_issued', 'issuedAt', null, 'revokedAt', null, 'encryptedToken', null);
  end if;
  return jsonb_build_object(
    'status', case when revoked_at_value is null then 'active' else 'revoked' end,
    'issuedAt', issued_at_value,
    'revokedAt', revoked_at_value,
    'encryptedToken', case when revoked_at_value is null then encrypted_token_value else null end
  );
end;
$$;

revoke all on function public.issue_employee_qr_token_with_ciphertext(uuid,uuid,text,text,boolean) from public, anon;
grant execute on function public.issue_employee_qr_token_with_ciphertext(uuid,uuid,text,text,boolean) to authenticated;
revoke all on function public.get_own_employee_credential_status(uuid,uuid) from public, anon;
grant execute on function public.get_own_employee_credential_status(uuid,uuid) to authenticated;
