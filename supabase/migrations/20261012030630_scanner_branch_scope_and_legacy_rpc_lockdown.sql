-- Restrict scanner operations to the authorized device branch and close the legacy PIN bypass.
-- All changes are transactional and preserve existing attendance rows.
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
    if pin_result->>'status'='locked' then raise exception 'pin locked' using errcode='P0001'; end if;
    if pin_result->>'status'='not_configured' then raise exception 'pin not configured' using errcode='23514'; end if;
    raise exception 'pin invalid' using errcode='22023';
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
    if pin_result->>'status'='locked' then raise exception 'pin locked' using errcode='P0001'; end if;
    if pin_result->>'status'='not_configured' then raise exception 'pin not configured' using errcode='23514'; end if;
    raise exception 'pin invalid' using errcode='22023';
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

create or replace function private.record_attendance_event(
 p_company_id uuid,p_employee_qr_token text,p_device_token text,p_event public.attendance_event_type,
 p_idempotency_key uuid,p_break_rule_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare event_id uuid; mid uuid; device uuid; device_branch uuid; emp uuid; sess uuid; hash_qr bytea; hash_device bytea;
begin
 if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
 if p_event not in ('clock_in','break_start','break_end','clock_out') then raise exception 'unsupported event'; end if;
 hash_qr:=extensions.digest(convert_to(p_employee_qr_token,'UTF8'),'sha256');
 hash_device:=extensions.digest(convert_to(p_device_token,'UTF8'),'sha256');
 select s.membership_id,d.id,d.branch_id into mid,device,device_branch from public.authorized_devices d
  join public.supervisors s on s.company_id=d.company_id and s.membership_id=d.membership_id
  join private.device_token_hashes h on h.device_id=d.id
  where d.company_id=p_company_id and d.active and d.revoked_at is null and h.token_hash=hash_device
    and s.membership_id in (select m.id from public.company_memberships m where m.user_id=(select auth.uid()) and m.active)
    and exists(select 1 from public.supervisor_branches sb where sb.company_id=d.company_id and sb.membership_id=d.membership_id and sb.branch_id=d.branch_id);
 if device is null then raise exception 'unauthorized supervisor device' using errcode='42501'; end if;
 if not private.has_company_permission(p_company_id,'attendance.scan') then raise exception 'permission denied' using errcode='42501'; end if;
 select q.employee_id into emp from private.employee_qr_tokens q join public.employees e on e.id=q.employee_id
  where e.company_id=p_company_id and e.active and q.revoked_at is null and q.token_hash=hash_qr;
 if emp is null then raise exception 'invalid employee QR token' using errcode='42501'; end if;
 if not exists(select 1 from public.employees e where e.company_id=p_company_id and e.id=emp and e.branch_id=device_branch) then
  raise exception 'employee branch access denied' using errcode='42501';
 end if;
 if p_event='clock_in' then
  insert into public.attendance_sessions(company_id,employee_id,branch_id,assignment_id,labor_rule_set_id,
    local_work_date,timezone,scheduled_start_at,scheduled_end_at,scheduled_minutes,
    late_tolerance_minutes,early_departure_tolerance_minutes)
   select p_company_id,emp,d.branch_id,a.id,lr.id,local.local_day,b.timezone,
    case when a.template_id is null then
      case when a.planned_start_local is null then null else (local.local_day+a.planned_start_local) at time zone b.timezone end
     else case when a.day_start is null then null else (local.local_day+a.day_start) at time zone b.timezone end end,
    case when a.template_id is null then
      case when a.planned_end_local is null then null else ((local.local_day + case when a.planned_end_local<=a.planned_start_local then 1 else 0 end)+a.planned_end_local) at time zone b.timezone end
     else case when a.day_end is null then null else ((local.local_day + case when a.day_end<=a.day_start then 1 else 0 end)+a.day_end) at time zone b.timezone end end,
    case when a.template_id is null then a.planned_minutes else a.day_minutes end,
    greatest(coalesce(a.day_entry_tolerance_minutes, 0), coalesce(lr.late_grace_minutes, 0)),
    coalesce(lr.early_departure_grace_minutes, 0)
   from public.authorized_devices d join public.branches b on b.company_id=d.company_id and b.id=d.branch_id
   cross join lateral (select (clock_timestamp() at time zone b.timezone)::date as local_day) local
   left join lateral (
     select x.*,sd.start_local as day_start,sd.end_local as day_end,sd.scheduled_minutes as day_minutes,
       t.entry_tolerance_minutes as day_entry_tolerance_minutes
     from public.schedule_assignments x
     left join public.schedule_templates t on t.company_id=x.company_id and t.id=x.template_id
     left join public.schedule_template_days sd on sd.company_id=x.company_id
       and sd.template_id=x.template_id and sd.iso_weekday=extract(isodow from local.local_day)::smallint
     where x.company_id=p_company_id and x.employee_id=emp and x.branch_id=d.branch_id
       and x.starts_on<=local.local_day and (x.ends_on is null or x.ends_on>=local.local_day)
     order by x.starts_on desc limit 1
   ) a on true
   left join lateral (select r.id,
      case when r.settings->>'lateGraceMinutes' ~ '^[0-9]{1,4}$'
        then least(1440, (r.settings->>'lateGraceMinutes')::integer)::smallint else 0::smallint end as late_grace_minutes,
      case when r.settings->>'earlyDepartureGraceMinutes' ~ '^[0-9]{1,4}$'
        then least(1440, (r.settings->>'earlyDepartureGraceMinutes')::integer)::smallint else 0::smallint end as early_departure_grace_minutes
     from public.labor_rule_sets r where r.company_id=p_company_id
      and r.effective_from<=local.local_day and (r.effective_to is null or r.effective_to>=local.local_day)
      order by r.effective_from desc limit 1) lr on true
   where d.id=device returning id into sess;
 else
  select id into sess from public.attendance_sessions where company_id=p_company_id and employee_id=emp and status='open' for update;
  if sess is null then raise exception 'no open attendance session' using errcode='23514'; end if;
 end if;
 insert into public.attendance_events(company_id,session_id,event_type,recorded_by,device_id,idempotency_key,metadata)
 values(p_company_id,sess,p_event,(select auth.uid()),device,p_idempotency_key,
  case when p_break_rule_id is null then '{}'::jsonb else jsonb_build_object('break_rule_id',p_break_rule_id) end)
 returning id into event_id;
 if p_event='break_start' and p_break_rule_id is not null then
  update public.attendance_breaks set break_rule_id=p_break_rule_id,
    counts_as_work=(select counts_as_work from public.break_rules where id=p_break_rule_id and company_id=p_company_id)
   where start_event_id=event_id;
 end if;
 return event_id;
end $$;

revoke all on function public.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid) from public, anon, authenticated;
revoke all on function private.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid) from public, anon, authenticated, service_role;

select pg_catalog.pg_notify('pgrst','reload schema');
commit;
