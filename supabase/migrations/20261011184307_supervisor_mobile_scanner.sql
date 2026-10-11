-- Supervisor mobile scanner: request/approval for device credentials and
-- PIN-gated, transactionally validated attendance operations.

create table private.device_authorization_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  branch_id uuid not null,
  membership_id uuid not null,
  label text not null check (length(trim(label)) between 1 and 100),
  challenge_hash bytea not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','revoked')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  device_id uuid,
  redeemed_at timestamptz,
  foreign key (company_id, membership_id) references public.supervisors(company_id,membership_id) on delete restrict,
  foreign key (company_id, branch_id) references public.branches(company_id,id) on delete restrict,
  foreign key (company_id, device_id) references public.authorized_devices(company_id,id) on delete restrict,
  check ((status = 'pending') = (reviewed_at is null)),
  check ((status in ('approved','revoked')) = (device_id is not null)),
  unique (id, membership_id)
);
create unique index device_requests_one_pending_per_browser
  on private.device_authorization_requests(membership_id, challenge_hash) where status='pending';
create index device_requests_company_status_time
  on private.device_authorization_requests(company_id,status,requested_at desc);
alter table private.device_authorization_requests enable row level security;
revoke all on private.device_authorization_requests from public, anon, authenticated, service_role;

create or replace function private.scanner_device(p_company_id uuid, p_device_token text)
returns table(device_id uuid, membership_id uuid, branch_id uuid)
language sql security definer set search_path = '' as $$
  select d.id, d.membership_id, d.branch_id
  from public.authorized_devices d
  join private.device_token_hashes h on h.device_id=d.id
  join public.company_memberships m on m.company_id=d.company_id and m.id=d.membership_id
  where d.company_id=p_company_id and d.active and d.revoked_at is null
    and m.user_id=(select auth.uid()) and m.active and m.role='supervisor'
    and private.has_company_permission(d.company_id,'attendance.scan')
    and exists(select 1 from public.supervisors s where s.company_id=d.company_id and s.membership_id=d.membership_id)
    and exists(select 1 from public.supervisor_branches sb where sb.company_id=d.company_id
      and sb.membership_id=d.membership_id and sb.branch_id=d.branch_id)
    and h.token_hash=extensions.digest(convert_to(p_device_token,'UTF8'),'sha256')
  limit 1
$$;
revoke all on function private.scanner_device(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.request_supervisor_device(p_company_id uuid,p_branch_id uuid,p_label text,p_challenge text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare mid uuid; req uuid; normalized_label text;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  normalized_label:=trim(p_label);
  if normalized_label is null or length(normalized_label) not between 1 and 100
     or p_challenge !~ '^[A-Za-z0-9_-]{40,60}$' then
    raise exception 'invalid device request' using errcode='22023';
  end if;
  select m.id into mid from public.company_memberships m
    join public.supervisors s on s.company_id=m.company_id and s.membership_id=m.id
    join public.supervisor_branches sb on sb.company_id=m.company_id and sb.membership_id=m.id
    join public.branches b on b.company_id=sb.company_id and b.id=sb.branch_id and b.active
   where m.company_id=p_company_id and sb.branch_id=p_branch_id and m.user_id=(select auth.uid())
     and m.role='supervisor' and m.active and private.has_company_permission(m.company_id,'attendance.scan');
  if mid is null then raise exception 'supervisor branch access denied' using errcode='42501'; end if;
  select id into req from private.device_authorization_requests
   where membership_id=mid and branch_id=p_branch_id and challenge_hash=extensions.digest(convert_to(p_challenge,'UTF8'),'sha256')
     and status in ('pending','approved') and (status='pending' or redeemed_at is null)
   order by requested_at desc limit 1;
  if req is null then
    insert into private.device_authorization_requests(company_id,branch_id,membership_id,label,challenge_hash)
    values(p_company_id,p_branch_id,mid,normalized_label,extensions.digest(convert_to(p_challenge,'UTF8'),'sha256'))
    returning id into req;
    insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
    values(p_company_id,(select auth.uid()),'DEVICE_AUTHORIZATION_REQUESTED','device_authorization_requests',req,
      jsonb_build_object('branchId',p_branch_id,'label',normalized_label));
  end if;
  return jsonb_build_object('requestId',req,'status',(select status from private.device_authorization_requests where id=req));
end $$;
revoke all on function public.request_supervisor_device(uuid,uuid,text,text) from public,anon;
grant execute on function public.request_supervisor_device(uuid,uuid,text,text) to authenticated;

create or replace function public.list_supervisor_device_requests(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or not private.has_company_permission(p_company_id,'devices.manage') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'branchId',r.branch_id,'branchName',b.name,
    'membershipId',r.membership_id,'supervisorName',coalesce(nullif(trim(concat_ws(' ',e.first_name,e.last_name)),''),u.email),
    'email',u.email,'label',r.label,'status',r.status,'requestedAt',r.requested_at)
    order by r.requested_at desc),'[]'::jsonb) into result
  from private.device_authorization_requests r
  join public.branches b on b.company_id=r.company_id and b.id=r.branch_id
  join public.company_memberships m on m.company_id=r.company_id and m.id=r.membership_id
  join auth.users u on u.id=m.user_id
  left join public.supervisors s on s.company_id=m.company_id and s.membership_id=m.id
  left join public.employees e on e.company_id=s.company_id and e.id=s.employee_id
  where r.company_id=p_company_id and r.status in ('pending','approved','rejected','revoked');
  return result;
end $$;
revoke all on function public.list_supervisor_device_requests(uuid) from public,anon;
grant execute on function public.list_supervisor_device_requests(uuid) to authenticated;

create or replace function public.review_supervisor_device_request(p_company_id uuid,p_request_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare req private.device_authorization_requests%rowtype; new_device uuid;
begin
  if (select auth.uid()) is null or not private.has_company_permission(p_company_id,'devices.manage') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  select * into req from private.device_authorization_requests where id=p_request_id and company_id=p_company_id for update;
  if not found then raise exception 'request not found' using errcode='P0002'; end if;
  if req.status <> 'pending' then raise exception 'request already reviewed' using errcode='23514'; end if;
  if p_approve then
    insert into public.authorized_devices(company_id,branch_id,membership_id,label)
      values(req.company_id,req.branch_id,req.membership_id,req.label) returning id into new_device;
  end if;
  update private.device_authorization_requests set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=(select auth.uid()),reviewed_at=clock_timestamp(),device_id=new_device where id=req.id;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,before_data,after_data)
  values(p_company_id,(select auth.uid()),case when p_approve then 'DEVICE_AUTHORIZATION_APPROVED' else 'DEVICE_AUTHORIZATION_REJECTED' end,
    'device_authorization_requests',req.id,jsonb_build_object('status','pending'),
    jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end,'deviceId',new_device));
  return jsonb_build_object('requestId',req.id,'status',case when p_approve then 'approved' else 'rejected' end,'deviceId',new_device);
end $$;
revoke all on function public.review_supervisor_device_request(uuid,uuid,boolean) from public,anon;
grant execute on function public.review_supervisor_device_request(uuid,uuid,boolean) to authenticated;

create or replace function public.redeem_supervisor_device(p_company_id uuid,p_challenge text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare req private.device_authorization_requests%rowtype; who uuid;
begin
  who:=(select auth.uid());
  if who is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_challenge !~ '^[A-Za-z0-9_-]{40,60}$' then raise exception 'invalid challenge' using errcode='22023'; end if;
  select r.* into req from private.device_authorization_requests r
    join public.company_memberships m on m.company_id=r.company_id and m.id=r.membership_id
   where r.company_id=p_company_id and m.user_id=who and m.active and m.role='supervisor'
     and r.challenge_hash=extensions.digest(convert_to(p_challenge,'UTF8'),'sha256')
   order by r.requested_at desc limit 1 for update of r;
  if not found then return jsonb_build_object('status','unrequested'); end if;
  if req.status='pending' then return jsonb_build_object('status','pending','requestId',req.id); end if;
  if req.status<>'approved' or req.redeemed_at is not null then return jsonb_build_object('status',req.status,'requestId',req.id); end if;
  if not exists(select 1 from public.supervisor_branches sb where sb.company_id=req.company_id and sb.membership_id=req.membership_id and sb.branch_id=req.branch_id) then
    update private.device_authorization_requests set status='revoked' where id=req.id;
    update public.authorized_devices set active=false,revoked_at=clock_timestamp() where id=req.device_id and company_id=req.company_id;
    return jsonb_build_object('status','revoked','requestId',req.id);
  end if;
  insert into private.device_token_hashes(device_id,token_hash) values(req.device_id,req.challenge_hash)
    on conflict(device_id) do update set token_hash=excluded.token_hash,rotated_at=clock_timestamp();
  update private.device_authorization_requests set redeemed_at=clock_timestamp() where id=req.id;
  return jsonb_build_object('status','authorized','requestId',req.id);
end $$;
revoke all on function public.redeem_supervisor_device(uuid,text) from public,anon;
grant execute on function public.redeem_supervisor_device(uuid,text) to authenticated;

create or replace function public.get_supervisor_scanner_context(p_company_id uuid,p_device_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare mid uuid; dev record; payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  select m.id into mid from public.company_memberships m join public.supervisors s
    on s.company_id=m.company_id and s.membership_id=m.id
   where m.company_id=p_company_id and m.user_id=(select auth.uid()) and m.role='supervisor' and m.active
     and private.has_company_permission(m.company_id,'attendance.scan');
  if mid is null then raise exception 'supervisor required' using errcode='42501'; end if;
  if p_device_token is not null then
    select * into dev from private.scanner_device(p_company_id,p_device_token) where membership_id=mid limit 1;
  end if;
  select jsonb_build_object('companyId',c.id,'companyName',c.name,'supervisorName',
    coalesce(nullif(trim(concat_ws(' ',e.first_name,e.last_name)),''),u.email),
    'authorized',dev.device_id is not null,'deviceId',dev.device_id,'branchId',dev.branch_id,
    'branchName',db.name,'timezone',db.timezone,
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'timezone',b.timezone) order by b.name)
      from public.supervisor_branches sb join public.branches b on b.company_id=sb.company_id and b.id=sb.branch_id
      where sb.company_id=c.id and sb.membership_id=mid and b.active),'[]'::jsonb)) into payload
  from public.companies c
  join public.company_memberships m on m.company_id=c.id and m.id=mid
  join auth.users u on u.id=m.user_id
  left join public.supervisors s on s.company_id=m.company_id and s.membership_id=m.id
  left join public.employees e on e.company_id=s.company_id and e.id=s.employee_id
  left join public.branches db on db.company_id=c.id and db.id=dev.branch_id
  where c.id=p_company_id;
  if dev.device_id is not null then
    select payload || jsonb_build_object('recentMovements',coalesce((select jsonb_agg(jsonb_build_object(
      'employeeName',x.employee_name,'eventType',x.event_type,'occurredAt',x.occurred_at) order by x.occurred_at desc)
      from (select trim(concat_ws(' ',e.first_name,e.last_name)) as employee_name,ev.event_type,ev.occurred_at
        from public.attendance_events ev join public.attendance_sessions s on s.company_id=ev.company_id and s.id=ev.session_id
        join public.employees e on e.company_id=s.company_id and e.id=s.employee_id
        where ev.company_id=p_company_id and ev.recorded_by=(select auth.uid()) and ev.device_id=dev.device_id
          and ev.occurred_at>=clock_timestamp()-interval '7 days'
        order by ev.occurred_at desc limit 10) x),'[]'::jsonb)) into payload;
  else
    payload:=payload || jsonb_build_object('recentMovements','[]'::jsonb);
  end if;
  return payload;
end $$;
revoke all on function public.get_supervisor_scanner_context(uuid,text) from public,anon;
grant execute on function public.get_supervisor_scanner_context(uuid,text) to authenticated;

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
revoke all on function public.scan_employee_attendance(uuid,text,text,text) from public,anon;
grant execute on function public.scan_employee_attendance(uuid,text,text,text) to authenticated;

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
revoke all on function public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid) from public,anon;
grant execute on function public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid) to authenticated;

create or replace function public.list_supervisors_and_branches(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or not private.has_company_permission(p_company_id,'devices.manage') then raise exception 'permission denied' using errcode='42501'; end if;
  select jsonb_build_object('branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.branches where company_id=p_company_id and active),'[]'::jsonb),
    'supervisors',coalesce((select jsonb_agg(jsonb_build_object('membershipId',m.id,'email',u.email,'name',coalesce(nullif(trim(concat_ws(' ',e.first_name,e.last_name)),''),u.email),
      'branches',coalesce((select jsonb_agg(sb.branch_id order by sb.branch_id) from public.supervisor_branches sb where sb.company_id=m.company_id and sb.membership_id=m.id),'[]'::jsonb)) order by u.email)
      from public.company_memberships m left join public.supervisors s on s.company_id=m.company_id and s.membership_id=m.id
      join auth.users u on u.id=m.user_id left join public.employees e on e.company_id=s.company_id and e.id=s.employee_id
      where m.company_id=p_company_id and m.role='supervisor' and m.active),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.list_supervisors_and_branches(uuid) from public,anon;
grant execute on function public.list_supervisors_and_branches(uuid) to authenticated;

create or replace function public.set_supervisor_branch(p_company_id uuid,p_membership_id uuid,p_branch_id uuid,p_assigned boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.has_company_permission(p_company_id,'devices.manage') then raise exception 'permission denied' using errcode='42501'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.id=p_membership_id and m.active and m.role='supervisor')
     or not exists(select 1 from public.branches b where b.company_id=p_company_id and b.id=p_branch_id and b.active) then
    raise exception 'supervisor or branch unavailable' using errcode='23514';
  end if;
  insert into public.supervisors(company_id,membership_id) values(p_company_id,p_membership_id) on conflict do nothing;
  if p_assigned then
    insert into public.supervisor_branches(company_id,membership_id,branch_id) values(p_company_id,p_membership_id,p_branch_id) on conflict do nothing;
  else
    delete from public.supervisor_branches where company_id=p_company_id and membership_id=p_membership_id and branch_id=p_branch_id;
    update private.device_authorization_requests set status='revoked' where company_id=p_company_id and membership_id=p_membership_id and branch_id=p_branch_id and status='approved';
    update public.authorized_devices set active=false,revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company_id and membership_id=p_membership_id and branch_id=p_branch_id and active;
  end if;
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
  values(p_company_id,(select auth.uid()),case when p_assigned then 'SUPERVISOR_BRANCH_ASSIGNED' else 'SUPERVISOR_BRANCH_UNASSIGNED' end,
    'supervisor_branches',p_membership_id,jsonb_build_object('branchId',p_branch_id));
  return jsonb_build_object('membershipId',p_membership_id,'branchId',p_branch_id,'assigned',p_assigned);
end $$;
revoke all on function public.set_supervisor_branch(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.set_supervisor_branch(uuid,uuid,uuid,boolean) to authenticated;

create or replace function public.list_authorized_supervisor_devices(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or not private.has_company_permission(p_company_id,'devices.manage') then raise exception 'permission denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'membershipId',d.membership_id,'branchId',d.branch_id,
    'branchName',b.name,'label',d.label,'active',d.active,'createdAt',d.created_at,'supervisorName',
    coalesce(nullif(trim(concat_ws(' ',e.first_name,e.last_name)),''),u.email)) order by d.created_at desc),'[]'::jsonb) into result
  from public.authorized_devices d join public.branches b on b.company_id=d.company_id and b.id=d.branch_id
  join public.company_memberships m on m.company_id=d.company_id and m.id=d.membership_id join auth.users u on u.id=m.user_id
  left join public.supervisors s on s.company_id=m.company_id and s.membership_id=m.id
  left join public.employees e on e.company_id=s.company_id and e.id=s.employee_id
  where d.company_id=p_company_id;
  return result;
end $$;
revoke all on function public.list_authorized_supervisor_devices(uuid) from public,anon;
grant execute on function public.list_authorized_supervisor_devices(uuid) to authenticated;

create or replace function public.revoke_supervisor_device(p_company_id uuid,p_device_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare changed uuid;
begin
  if (select auth.uid()) is null or not private.has_company_permission(p_company_id,'devices.manage') then raise exception 'permission denied' using errcode='42501'; end if;
  update public.authorized_devices set active=false,revoked_at=coalesce(revoked_at,clock_timestamp())
   where company_id=p_company_id and id=p_device_id and active returning id into changed;
  if changed is null then raise exception 'device not found or already revoked' using errcode='P0002'; end if;
  update private.device_authorization_requests set status='revoked' where company_id=p_company_id and device_id=p_device_id and status='approved';
  insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,after_data)
   values(p_company_id,(select auth.uid()),'SUPERVISOR_DEVICE_REVOKED','authorized_devices',p_device_id,jsonb_build_object('active',false));
  return jsonb_build_object('deviceId',changed,'active',false);
end $$;
revoke all on function public.revoke_supervisor_device(uuid,uuid) from public,anon;
grant execute on function public.revoke_supervisor_device(uuid,uuid) to authenticated;
