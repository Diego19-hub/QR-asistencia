-- Commit failed PIN accounting by returning a structured rejection instead of
-- raising after private.verify_employee_pin updates the locked credential row.
begin;

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
  pin_result:=private.verify_employee_pin(p_company_id,emp,p_pin);
  if not coalesce((pin_result->>'valid')::boolean,false) then
    -- Return normally so the verifier's locked-row update commits with this RPC.
    -- Do not include employee details in rejected credential responses.
    return jsonb_build_object('pinError',case
      when pin_result->>'status'='locked' then 'pin_locked'
      when pin_result->>'status'='not_configured' then 'pin_not_configured'
      else 'pin_invalid' end);
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
  pin_result:=private.verify_employee_pin(p_company_id,emp,p_pin);
  if not coalesce((pin_result->>'valid')::boolean,false) then
    -- Return normally so the verifier's locked-row update commits with this RPC.
    -- Do not include employee details in rejected credential responses.
    return jsonb_build_object('pinError',case
      when pin_result->>'status'='locked' then 'pin_locked'
      when pin_result->>'status'='not_configured' then 'pin_not_configured'
      else 'pin_invalid' end);
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
commit;
