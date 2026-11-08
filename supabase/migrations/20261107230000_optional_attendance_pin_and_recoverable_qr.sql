-- Optional PIN policy and recoverable employee QR credentials.
-- QR bearer tokens remain encrypted at rest; hashes remain the attendance lookup key.
begin;

alter table public.companies add column if not exists require_employee_pin boolean not null default false;
alter table private.employee_qr_tokens add column if not exists encrypted_token text;

create or replace function public.scan_employee_attendance(p_company_id uuid,p_employee_qr_token text,p_pin text,p_device_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare dev record; emp uuid; pin_result jsonb; sess public.attendance_sessions%rowtype; last_event public.attendance_event_type;
  next_actions jsonb:='[]'::jsonb; rules jsonb:='[]'::jsonb; work_day date;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into dev from private.scanner_device(p_company_id,p_device_token) limit 1;
  if dev.device_id is null then raise exception 'device unauthorized' using errcode='42501'; end if;
  select q.employee_id into emp from private.employee_qr_tokens q join public.employees e on e.id=q.employee_id
   where e.company_id=p_company_id and e.active and q.revoked_at is null
    and q.token_hash=extensions.digest(convert_to(p_employee_qr_token,'UTF8'),'sha256');
  if emp is null then raise exception 'credential unavailable' using errcode='P0002'; end if;
  if not exists(select 1 from public.employees e where e.company_id=p_company_id and e.id=emp and e.branch_id=dev.branch_id) then
    raise exception 'employee branch access denied' using errcode='42501';
  end if;
  if coalesce((select c.require_employee_pin from public.companies c where c.id=p_company_id),false) then
    pin_result:=private.verify_employee_pin(p_company_id,emp,p_pin);
    if not coalesce((pin_result->>'valid')::boolean,false) then
      -- Return normally so the verifier's locked-row update commits with this RPC.
      return jsonb_build_object('pinError',case
        when pin_result->>'status'='locked' then 'pin_locked'
        when pin_result->>'status'='not_configured' then 'pin_not_configured'
        else 'pin_invalid' end);
    end if;
  end if;
  select * into sess from public.attendance_sessions where company_id=p_company_id and employee_id=emp and status='open' limit 1;
  if not found then
    next_actions:=jsonb_build_array(jsonb_build_object('type','clock_in','label','Entrada al trabajo'));
    work_day:=(clock_timestamp() at time zone (select timezone from public.branches where id=dev.branch_id and company_id=p_company_id))::date;
  else
    work_day:=sess.local_work_date;
    select event_type into last_event from public.attendance_events where company_id=p_company_id and session_id=sess.id order by sequence_no desc limit 1;
    if last_event in ('clock_in','break_end') then
      next_actions:=jsonb_build_array(jsonb_build_object('type','clock_out','label','Salida del trabajo'),jsonb_build_object('type','break_start','label','Salida a comer'));
      select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'code',r.code,'name',r.name,'countsAsWork',r.counts_as_work) order by
        case when lower(r.name) like '%comida%' or lower(r.name) like '%alimento%' then 0 else 1 end,r.name),'[]'::jsonb)
       into rules from public.break_rules r where r.company_id=p_company_id and r.effective_from<=work_day
        and (r.effective_to is null or r.effective_to>=work_day);
      if jsonb_array_length(rules)=0 then next_actions:=jsonb_build_array(jsonb_build_object('type','clock_out','label','Salida del trabajo')); end if;
    elsif last_event='break_start' then
      next_actions:=jsonb_build_array(jsonb_build_object('type','break_end','label','Regreso de comida'));
    end if;
  end if;
  return jsonb_build_object('employeeId',emp,'employeeName',(select trim(concat_ws(' ',first_name,last_name)) from public.employees where id=emp and company_id=p_company_id),
    'sessionId',sess.id,'allowedActions',next_actions,'breakRules',rules);
end $$;

create or replace function public.confirm_employee_attendance(p_company_id uuid,p_employee_qr_token text,p_pin text,
  p_device_token text,p_event public.attendance_event_type,p_idempotency_key uuid,p_break_rule_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare dev record; emp uuid; pin_result jsonb; sess public.attendance_sessions%rowtype; last_event public.attendance_event_type;
  event_id uuid; event_at timestamptz; effective_rule uuid;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_idempotency_key is null or p_event not in ('clock_in','break_start','break_end','clock_out') then
    raise exception 'invalid attendance action' using errcode='22023';
  end if;
  select * into dev from private.scanner_device(p_company_id,p_device_token) limit 1;
  if dev.device_id is null then raise exception 'device unauthorized' using errcode='42501'; end if;
  select q.employee_id into emp from private.employee_qr_tokens q join public.employees e on e.id=q.employee_id
   where e.company_id=p_company_id and e.active and q.revoked_at is null
    and q.token_hash=extensions.digest(convert_to(p_employee_qr_token,'UTF8'),'sha256');
  if emp is null then raise exception 'credential unavailable' using errcode='P0002'; end if;
  if not exists(select 1 from public.employees e where e.company_id=p_company_id and e.id=emp and e.branch_id=dev.branch_id) then
    raise exception 'employee branch access denied' using errcode='42501';
  end if;
  if coalesce((select c.require_employee_pin from public.companies c where c.id=p_company_id),false) then
    pin_result:=private.verify_employee_pin(p_company_id,emp,p_pin);
    if not coalesce((pin_result->>'valid')::boolean,false) then
      -- Return normally so the verifier's locked-row update commits with this RPC.
      return jsonb_build_object('pinError',case
        when pin_result->>'status'='locked' then 'pin_locked'
        when pin_result->>'status'='not_configured' then 'pin_not_configured'
        else 'pin_invalid' end);
    end if;
  end if;
  -- A retry of the same accepted request returns its original timestamp and event.
  select ev.id,ev.occurred_at into event_id,event_at from public.attendance_events ev
    join public.attendance_sessions s on s.company_id=ev.company_id and s.id=ev.session_id
   where ev.company_id=p_company_id and ev.idempotency_key=p_idempotency_key and ev.recorded_by=(select auth.uid())
     and ev.device_id=dev.device_id and s.employee_id=emp and ev.event_type=p_event;
  if event_id is not null then
    return jsonb_build_object('eventId',event_id,'occurredAt',event_at,'eventType',p_event,'employeeId',emp,
      'employeeName',(select trim(concat_ws(' ',first_name,last_name)) from public.employees where id=emp and company_id=p_company_id),'duplicate',true);
  end if;
  select * into sess from public.attendance_sessions where company_id=p_company_id and employee_id=emp and status='open' for update;
  if p_event='clock_in' then
    if found then raise exception 'invalid attendance transition' using errcode='23514'; end if;
  else
    if not found then raise exception 'no open session' using errcode='23514'; end if;
    select event_type into last_event from public.attendance_events where company_id=p_company_id and session_id=sess.id order by sequence_no desc limit 1;
    if not ((p_event='break_start' and last_event in ('clock_in','break_end')) or
      (p_event='clock_out' and last_event in ('clock_in','break_end')) or (p_event='break_end' and last_event='break_start')) then
      raise exception 'invalid attendance transition' using errcode='23514';
    end if;
  end if;
  if p_event='break_start' then
    if p_break_rule_id is null or not exists(select 1 from public.break_rules r where r.company_id=p_company_id
       and r.id=p_break_rule_id and r.effective_from<=sess.local_work_date and (r.effective_to is null or r.effective_to>=sess.local_work_date)) then
      raise exception 'break rule required' using errcode='22023';
    end if;
    effective_rule:=p_break_rule_id;
  elsif p_break_rule_id is not null then raise exception 'unexpected break rule' using errcode='22023'; end if;
  event_id:=private.record_attendance_event(p_company_id,p_employee_qr_token,p_device_token,p_event,p_idempotency_key,effective_rule);
  select occurred_at into event_at from public.attendance_events where id=event_id and company_id=p_company_id;
  return jsonb_build_object('eventId',event_id,'occurredAt',event_at,'eventType',p_event,'employeeId',emp,
    'employeeName',(select trim(concat_ws(' ',first_name,last_name)) from public.employees where id=emp and company_id=p_company_id),'duplicate',false);
end $$;

revoke all on function public.scan_employee_attendance(uuid,text,text,text) from public, anon;
grant execute on function public.scan_employee_attendance(uuid,text,text,text) to authenticated;
revoke all on function public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid) from public, anon;
grant execute on function public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid) to authenticated;

select pg_catalog.pg_notify('pgrst','reload schema');


-- The five-argument overload stores a server-encrypted copy atomically with issuance.
-- The old four-argument overload remains for compatibility; it cannot populate a QR for employee self-service.
create or replace function public.issue_employee_qr_token(
  p_company_id uuid, p_employee_id uuid, p_token_hash_hex text,
  p_replace boolean, p_encrypted_token text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_encrypted_token is null or length(p_encrypted_token)>2048
     or p_encrypted_token !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
    raise exception 'invalid encrypted credential' using errcode='22023';
  end if;
  result := public.issue_employee_qr_token(p_company_id,p_employee_id,p_token_hash_hex,p_replace);
  update private.employee_qr_tokens q set encrypted_token=p_encrypted_token
   where q.employee_id=p_employee_id and q.revoked_at is null
     and exists(select 1 from public.employees e where e.company_id=p_company_id and e.id=q.employee_id);
  if not found then raise exception 'credential unavailable' using errcode='P0002'; end if;
  return result;
end $$;
revoke all on function public.issue_employee_qr_token(uuid,uuid,text,boolean,text) from public,anon;
grant execute on function public.issue_employee_qr_token(uuid,uuid,text,boolean,text) to authenticated;

create or replace function public.get_own_employee_qr_credential(p_company_id uuid,p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare issued timestamptz; revoked timestamptz; ciphertext text;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists(
    select 1 from public.company_memberships m
    join public.employees e on e.company_id=m.company_id
    where m.company_id=p_company_id and m.user_id=(select auth.uid()) and m.active and m.role='employee'
      and e.id=p_employee_id and e.auth_user_id=(select auth.uid()) and e.active
  ) then raise exception 'employee profile unavailable' using errcode='42501'; end if;
  select q.issued_at,q.revoked_at,q.encrypted_token into issued,revoked,ciphertext
    from private.employee_qr_tokens q where q.employee_id=p_employee_id;
  if not found then return jsonb_build_object('status','not_issued'); end if;
  if revoked is not null then return jsonb_build_object('status','revoked','issuedAt',issued,'revokedAt',revoked); end if;
  return jsonb_build_object('status','active','issuedAt',issued,'encryptedToken',ciphertext,
    'recoverable',ciphertext is not null);
end $$;
revoke all on function public.get_own_employee_qr_credential(uuid,uuid) from public,anon;
grant execute on function public.get_own_employee_qr_credential(uuid,uuid) to authenticated;

create or replace function public.revoke_employee_qr_token(p_company_id uuid,p_employee_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare employee_active boolean; changed_at timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not private.has_company_permission(p_company_id,'employees.manage') then raise exception 'permission denied' using errcode='42501'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id
      and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin')) then
    raise exception 'admin role required' using errcode='42501';
  end if;
  select e.active into employee_active from public.employees e
   where e.company_id=p_company_id and e.id=p_employee_id for update;
  if not found then raise exception 'employee not found' using errcode='P0002'; end if;
  update private.employee_qr_tokens set revoked_at=clock_timestamp(),encrypted_token=null
   where employee_id=p_employee_id and revoked_at is null returning revoked_at into changed_at;
  if changed_at is null then return jsonb_build_object('qrStatus','not_active'); end if;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
    values (p_company_id,(select auth.uid()),'EMPLOYEE_QR_REVOKED','employees',p_employee_id,
      jsonb_build_object('qrStatus','revoked','revokedAt',changed_at));
  return jsonb_build_object('qrStatus','revoked','revokedAt',changed_at);
end $$;
revoke all on function public.revoke_employee_qr_token(uuid,uuid) from public,anon;
grant execute on function public.revoke_employee_qr_token(uuid,uuid) to authenticated;

select pg_catalog.pg_notify('pgrst','reload schema');
commit;
