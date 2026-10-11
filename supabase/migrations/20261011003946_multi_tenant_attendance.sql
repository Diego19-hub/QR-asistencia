-- Multi-company attendance foundation. Instants are timestamptz (UTC); local
-- work dates/time zones are snapshotted where schedules and sessions are created.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create type public.company_role as enum ('owner','admin','supervisor','employee');
create type public.attendance_event_type as enum ('clock_in','break_start','break_end','clock_out');
create type public.schedule_kind as enum ('fixed','variable');
create type public.attendance_session_status as enum ('open','closed','adjusted');
create type public.overtime_status as enum ('pending','approved','rejected','cancelled');

create table public.companies (
 id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 180),
 legal_name text, rfc text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (rfc)
);
create table public.branches (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete restrict,
 name text not null, timezone text not null check (timezone <> ''), active boolean not null default true,
 created_at timestamptz not null default now(), unique(company_id,id), unique(company_id,name)
);
create table public.company_memberships (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict, role public.company_role not null,
 active boolean not null default true, created_at timestamptz not null default now(),
 unique(company_id,user_id), unique(company_id,id)
);
create table public.permissions (
 code text primary key, description text not null
);
create table public.role_permissions (
 role public.company_role not null, permission_code text not null references public.permissions(code) on delete cascade,
 primary key(role,permission_code)
);
create table public.membership_permission_overrides (
 company_id uuid not null, membership_id uuid not null, permission_code text not null references public.permissions(code),
 allowed boolean not null, created_at timestamptz not null default now(),
 primary key(membership_id,permission_code),
 foreign key(company_id,membership_id) references public.company_memberships(company_id,id) on delete cascade
);
create table public.employees (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete restrict,
 branch_id uuid, employee_number text not null, first_name text not null, last_name text not null,
 email text, auth_user_id uuid references auth.users(id) on delete restrict,
 active boolean not null default true, hired_on date, terminated_on date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,id), unique(company_id,employee_number), unique(company_id,auth_user_id),
 foreign key(company_id,branch_id) references public.branches(company_id,id) on delete restrict,
 check(terminated_on is null or hired_on is null or terminated_on >= hired_on)
);
create table public.supervisors (
 company_id uuid not null, membership_id uuid not null, employee_id uuid,
 created_at timestamptz not null default now(), primary key(company_id,membership_id),
 foreign key(company_id,membership_id) references public.company_memberships(company_id,id) on delete cascade,
 foreign key(company_id,employee_id) references public.employees(company_id,id) on delete restrict
);
create table public.supervisor_branches (
 company_id uuid not null, membership_id uuid not null, branch_id uuid not null,
 primary key(membership_id,branch_id),
 foreign key(company_id,membership_id) references public.supervisors(company_id,membership_id) on delete cascade,
 foreign key(company_id,branch_id) references public.branches(company_id,id) on delete cascade
);
create table public.authorized_devices (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, branch_id uuid not null,
 membership_id uuid not null, label text not null, active boolean not null default true,
 created_at timestamptz not null default now(), revoked_at timestamptz,
 unique(company_id,id), foreign key(company_id,membership_id) references public.supervisors(company_id,membership_id) on delete restrict,
 foreign key(company_id,branch_id) references public.branches(company_id,id) on delete restrict
);
create table private.device_token_hashes (
 device_id uuid primary key references public.authorized_devices(id) on delete cascade,
 token_hash bytea not null unique, created_at timestamptz not null default now(), rotated_at timestamptz
);
create table public.schedule_templates (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, branch_id uuid not null,
 name text not null, kind public.schedule_kind not null, active boolean not null default true,
 created_at timestamptz not null default now(), unique(company_id,id),
 foreign key(company_id,branch_id) references public.branches(company_id,id) on delete restrict
);
create table public.schedule_template_days (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, template_id uuid not null,
 iso_weekday smallint not null check(iso_weekday between 1 and 7), start_local time, end_local time,
 scheduled_minutes integer not null check(scheduled_minutes between 1 and 1440),
 unique(company_id,id), unique(template_id,iso_weekday),
 foreign key(company_id,template_id) references public.schedule_templates(company_id,id) on delete cascade,
 check((start_local is null and end_local is null) or (start_local is not null and end_local is not null))
);
create table public.schedule_assignments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null,
 employee_id uuid not null, template_id uuid, branch_id uuid not null,
 starts_on date not null, ends_on date, timezone text not null, kind public.schedule_kind not null,
 planned_start_local time, planned_end_local time, planned_minutes integer not null check(planned_minutes between 1 and 1440),
 created_at timestamptz not null default now(),
 unique(company_id,id), foreign key(company_id,employee_id) references public.employees(company_id,id) on delete restrict,
 foreign key(company_id,template_id) references public.schedule_templates(company_id,id) on delete restrict,
 foreign key(company_id,branch_id) references public.branches(company_id,id) on delete restrict,
 check(ends_on is null or ends_on >= starts_on),
 check(kind='variable' or (planned_start_local is not null and planned_end_local is not null))
);
create index schedule_assignments_employee_dates on public.schedule_assignments(company_id,employee_id,starts_on,ends_on);
create table public.labor_rule_sets (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, name text not null,
 effective_from date not null, effective_to date, settings jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), unique(company_id,id),
 foreign key(company_id) references public.companies(id) on delete restrict,
 check(effective_to is null or effective_to >= effective_from), check(jsonb_typeof(settings)='object')
);
create index labor_rule_sets_effective on public.labor_rule_sets(company_id,effective_from,effective_to);
create table public.break_rules (
 id uuid primary key default gen_random_uuid(), company_id uuid not null,
 code text not null, name text not null, effective_from date not null, effective_to date,
 counts_as_work boolean not null, required boolean not null default false,
 max_minutes integer check(max_minutes is null or max_minutes > 0),
 created_at timestamptz not null default now(), unique(company_id,id), unique(company_id,code,effective_from),
 foreign key(company_id) references public.companies(id) on delete restrict,
 check(effective_to is null or effective_to >= effective_from)
);
create table public.attendance_sessions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
 branch_id uuid not null, assignment_id uuid, labor_rule_set_id uuid, local_work_date date not null,
 timezone text not null, scheduled_start_at timestamptz, scheduled_end_at timestamptz,
 scheduled_minutes integer check(scheduled_minutes is null or scheduled_minutes > 0),
 status public.attendance_session_status not null default 'open', started_at timestamptz not null default now(),
 ended_at timestamptz, created_at timestamptz not null default now(),
 unique(company_id,id), foreign key(company_id,employee_id) references public.employees(company_id,id) on delete restrict,
 foreign key(company_id,branch_id) references public.branches(company_id,id) on delete restrict,
 foreign key(company_id,assignment_id) references public.schedule_assignments(company_id,id) on delete restrict,
 foreign key(company_id,labor_rule_set_id) references public.labor_rule_sets(company_id,id) on delete restrict,
 check(ended_at is null or ended_at >= started_at), check((status='open')=(ended_at is null))
);
create unique index attendance_one_open_session_per_employee on public.attendance_sessions(company_id,employee_id) where status='open';
create index attendance_sessions_company_date on public.attendance_sessions(company_id,local_work_date,employee_id);
create table private.employee_qr_tokens (
 employee_id uuid primary key references public.employees(id) on delete cascade,
 token_hash bytea not null unique, issued_at timestamptz not null default now(), revoked_at timestamptz
);
create table public.attendance_events (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, session_id uuid not null,
 event_type public.attendance_event_type not null, sequence_no integer not null check(sequence_no > 0),
 occurred_at timestamptz not null default clock_timestamp(), recorded_by uuid not null references auth.users(id) on delete restrict,
 device_id uuid not null,
 idempotency_key uuid not null, metadata jsonb not null default '{}'::jsonb,
 unique(company_id,id), unique(company_id,session_id,sequence_no), unique(company_id,idempotency_key),
 foreign key(company_id,session_id) references public.attendance_sessions(company_id,id) on delete restrict,
 foreign key(company_id,device_id) references public.authorized_devices(company_id,id) on delete restrict,
 check(jsonb_typeof(metadata)='object')
);
create index attendance_events_session_time on public.attendance_events(company_id,session_id,occurred_at);
create table public.attendance_breaks (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, session_id uuid not null,
 start_event_id uuid not null, end_event_id uuid, break_rule_id uuid,
 counts_as_work boolean not null, started_at timestamptz not null, ended_at timestamptz,
 created_at timestamptz not null default now(), unique(company_id,id),
 foreign key(company_id,session_id) references public.attendance_sessions(company_id,id) on delete restrict,
 foreign key(company_id,start_event_id) references public.attendance_events(company_id,id) on delete restrict,
 foreign key(company_id,end_event_id) references public.attendance_events(company_id,id) on delete restrict,
 foreign key(company_id,break_rule_id) references public.break_rules(company_id,id) on delete restrict,
 check(ended_at is null or ended_at >= started_at)
);
create unique index attendance_one_open_break_per_session on public.attendance_breaks(company_id,session_id) where ended_at is null;
create table public.attendance_adjustments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, session_id uuid not null,
 requested_by uuid not null references auth.users(id) on delete restrict, reviewed_by uuid references auth.users(id) on delete restrict,
 reason text not null check(length(trim(reason))>=5), proposed_events jsonb not null check(jsonb_typeof(proposed_events)='array'),
 status text not null default 'pending' check(status in ('pending','approved','rejected','voided')),
 created_at timestamptz not null default now(), reviewed_at timestamptz,
 foreign key(company_id,session_id) references public.attendance_sessions(company_id,id) on delete restrict,
 check((status in ('pending','voided') and reviewed_at is null) or (status in ('approved','rejected') and reviewed_at is not null))
);
create table public.overtime_assessments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, session_id uuid not null,
 detected_minutes integer not null check(detected_minutes>=0), rule_set_id uuid,
 assessed_at timestamptz not null default now(), detail jsonb not null default '{}'::jsonb,
 foreign key(company_id,session_id) references public.attendance_sessions(company_id,id) on delete restrict,
 foreign key(company_id,rule_set_id) references public.labor_rule_sets(company_id,id) on delete restrict,
 unique(company_id,session_id)
);
create table public.overtime_authorizations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, session_id uuid not null,
 minutes integer not null check(minutes>0), status public.overtime_status not null default 'pending',
 requested_by uuid not null references auth.users(id) on delete restrict,
 decided_by uuid references auth.users(id) on delete restrict, reason text not null,
 requested_at timestamptz not null default now(), decided_at timestamptz,
 foreign key(company_id,session_id) references public.attendance_sessions(company_id,id) on delete restrict,
 check((status in ('pending','cancelled') and decided_at is null) or (status in ('approved','rejected') and decided_at is not null))
);
create table public.audit_log (
 id bigint generated always as identity primary key, company_id uuid references public.companies(id) on delete restrict,
 actor_user_id uuid references auth.users(id) on delete set null, action text not null,
 entity_table text not null, entity_id uuid, occurred_at timestamptz not null default now(),
 before_data jsonb, after_data jsonb, request_id text
);
create index audit_log_company_time on public.audit_log(company_id,occurred_at desc);

-- Permission catalog is static configuration, not tenant-specific data.
insert into public.permissions(code,description) values
 ('company.read','Consultar información de empresa'),('company.manage','Administrar empresa y sucursales'),
 ('employees.read','Consultar empleados'),('employees.manage','Administrar empleados'),
 ('schedules.manage','Administrar horarios'),('attendance.read','Consultar asistencias'),
 ('attendance.scan','Registrar eventos de asistencia'),('attendance.adjust','Solicitar correcciones'),
 ('attendance.review_adjustments','Revisar correcciones'),('overtime.manage','Autorizar tiempo extraordinario'),
 ('reports.read','Consultar reportes'),('devices.manage','Administrar dispositivos de supervisión');
insert into public.role_permissions(role,permission_code)
 select 'owner',code from public.permissions;
insert into public.role_permissions(role,permission_code)
 select 'admin',code from public.permissions where code not in ('overtime.manage');
insert into public.role_permissions(role,permission_code) values
 ('supervisor','employees.read'),('supervisor','attendance.read'),('supervisor','attendance.scan'),
 ('supervisor','attendance.adjust'),('employee','attendance.read');

create or replace function private.has_company_permission(p_company_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(
  select 1 from public.company_memberships m
  join public.role_permissions rp on rp.role=m.role and rp.permission_code=p_permission
  where m.company_id=p_company_id and m.user_id=(select auth.uid()) and m.active
  and coalesce((select o.allowed from public.membership_permission_overrides o
                where o.company_id=m.company_id and o.membership_id=m.id
                  and o.permission_code=p_permission),
               exists(select 1 from public.role_permissions rp
                      where rp.role=m.role and rp.permission_code=p_permission))
 );
$$;
revoke all on function private.has_company_permission(uuid,text) from public,anon;
grant execute on function private.has_company_permission(uuid,text) to authenticated;

create or replace function private.guard_attendance_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.attendance_sessions%rowtype; previous_type public.attendance_event_type; previous_at timestamptz;
begin
 select * into s from public.attendance_sessions where id=new.session_id and company_id=new.company_id for update;
 if not found or s.status <> 'open' then raise exception 'attendance session is not open' using errcode='23514'; end if;
 select event_type,occurred_at into previous_type,previous_at from public.attendance_events
  where session_id=new.session_id and company_id=new.company_id order by sequence_no desc limit 1;
 if previous_type is null then
  if new.event_type <> 'clock_in' then raise exception 'first event must be clock_in' using errcode='23514'; end if;
  new.sequence_no:=1;
 else
  if new.occurred_at < previous_at then raise exception 'event timestamp must be monotonic' using errcode='23514'; end if;
  if not ((previous_type='clock_in' and new.event_type in ('break_start','clock_out')) or
          (previous_type='break_start' and new.event_type='break_end') or
          (previous_type='break_end' and new.event_type in ('break_start','clock_out'))) then
   raise exception 'invalid attendance event transition' using errcode='23514';
  end if;
  new.sequence_no:=coalesce((select max(sequence_no)+1 from public.attendance_events where session_id=new.session_id),1);
 end if;
 return new;
end $$;
revoke all on function private.guard_attendance_event() from public,anon,authenticated;
create trigger attendance_event_guard before insert on public.attendance_events
 for each row execute function private.guard_attendance_event();

create or replace function private.sync_attendance_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare br public.break_rules%rowtype; default_counts boolean:=false;
begin
 if new.event_type='clock_in' then
  update public.attendance_sessions set started_at=new.occurred_at where id=new.session_id and company_id=new.company_id;
 elsif new.event_type='break_start' then
  select r.* into br from public.break_rules r join public.attendance_sessions s on s.company_id=r.company_id
   where s.id=new.session_id and r.company_id=new.company_id and r.effective_from<=s.local_work_date
    and (r.effective_to is null or r.effective_to>=s.local_work_date)
   and (new.metadata->>'break_rule_id' is null or r.id=(new.metadata->>'break_rule_id')::uuid)
   order by r.effective_from desc limit 1;
  default_counts:=coalesce(br.counts_as_work,false);
  insert into public.attendance_breaks(company_id,session_id,start_event_id,break_rule_id,counts_as_work,started_at)
   values(new.company_id,new.session_id,new.id,br.id,default_counts,new.occurred_at);
 elsif new.event_type='break_end' then
  update public.attendance_breaks set end_event_id=new.id,ended_at=new.occurred_at
   where company_id=new.company_id and session_id=new.session_id and ended_at is null;
 elsif new.event_type='clock_out' then
  update public.attendance_sessions set ended_at=new.occurred_at,status='closed'
   where id=new.session_id and company_id=new.company_id;
 end if;
 return new;
end $$;
revoke all on function private.sync_attendance_event() from public,anon,authenticated;
create trigger attendance_event_sync after insert on public.attendance_events
 for each row execute function private.sync_attendance_event();

create or replace function private.write_audit_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare oldj jsonb; newj jsonb; company uuid; entity uuid;
begin
 if tg_op<>'INSERT' then oldj:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then newj:=to_jsonb(new); end if;
 company:=coalesce((newj->>'company_id')::uuid,(oldj->>'company_id')::uuid);
 entity:=coalesce((newj->>'id')::uuid,(oldj->>'id')::uuid);
 insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,before_data,after_data)
 values(company,(select auth.uid()),tg_op,tg_table_name,entity,oldj,newj);
 return coalesce(new,old);
end $$;
revoke all on function private.write_audit_log() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['companies','branches','company_memberships','employees','schedule_assignments',
 'labor_rule_sets','break_rules','attendance_sessions','attendance_events','attendance_breaks',
 'attendance_adjustments','overtime_assessments','overtime_authorizations','authorized_devices'] loop
  execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function private.write_audit_log()',t,t);
 end loop;
end $$;

create or replace function private.record_attendance_event(
 p_company_id uuid,p_employee_qr_token text,p_device_token text,p_event public.attendance_event_type,
 p_idempotency_key uuid,p_break_rule_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare event_id uuid; mid uuid; device uuid; emp uuid; sess uuid; hash_qr bytea; hash_device bytea;
begin
 if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
 if p_event not in ('clock_in','break_start','break_end','clock_out') then raise exception 'unsupported event'; end if;
 hash_qr:=extensions.digest(convert_to(p_employee_qr_token,'UTF8'),'sha256');
 hash_device:=extensions.digest(convert_to(p_device_token,'UTF8'),'sha256');
 select s.membership_id,d.id into mid,device from public.authorized_devices d
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
 if p_event='clock_in' then
  insert into public.attendance_sessions(company_id,employee_id,branch_id,assignment_id,labor_rule_set_id,
    local_work_date,timezone,scheduled_start_at,scheduled_end_at,scheduled_minutes)
   select p_company_id,emp,d.branch_id,a.id,lr.id,local.local_day,b.timezone,
    case when a.planned_start_local is null then null else (local.local_day+a.planned_start_local) at time zone b.timezone end,
    case when a.planned_end_local is null then null else
      ((local.local_day + case when a.planned_end_local<=a.planned_start_local then 1 else 0 end)+a.planned_end_local) at time zone b.timezone end,
    a.planned_minutes
   from public.authorized_devices d join public.branches b on b.company_id=d.company_id and b.id=d.branch_id
   cross join lateral (select (clock_timestamp() at time zone b.timezone)::date as local_day) local
   left join lateral (select x.* from public.schedule_assignments x where x.company_id=p_company_id and x.employee_id=emp
      and x.branch_id=d.branch_id and x.starts_on<=local.local_day and (x.ends_on is null or x.ends_on>=local.local_day)
      order by x.starts_on desc limit 1) a on true
   left join lateral (select r.id from public.labor_rule_sets r where r.company_id=p_company_id
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
revoke all on function private.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid) from public,anon,authenticated;
create or replace function public.record_attendance_event(
 p_company_id uuid,p_employee_qr_token text,p_device_token text,p_event public.attendance_event_type,
 p_idempotency_key uuid,p_break_rule_id uuid default null
) returns uuid language sql security invoker set search_path = '' as $$
 select private.record_attendance_event(p_company_id,p_employee_qr_token,p_device_token,p_event,p_idempotency_key,p_break_rule_id)
$$;
revoke all on function public.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid) from public,anon;
grant execute on function public.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid) to authenticated;

create view public.attendance_session_totals with (security_invoker=true) as
 select s.company_id,s.id as session_id,s.employee_id,s.local_work_date,s.timezone,s.status,s.started_at,s.ended_at,
  s.scheduled_minutes,
  greatest(0,floor(extract(epoch from (coalesce(s.ended_at,now())-s.started_at))/60)::integer) as presence_minutes,
  coalesce(sum(greatest(0,floor(extract(epoch from (coalesce(b.ended_at,now())-b.started_at))/60)::integer)) filter(where not b.counts_as_work),0)::integer as non_work_break_minutes,
  coalesce(sum(greatest(0,floor(extract(epoch from (coalesce(b.ended_at,now())-b.started_at))/60)::integer)),0)::integer as all_break_minutes,
  greatest(0,floor(extract(epoch from (coalesce(s.ended_at,now())-s.started_at))/60)::integer -
   coalesce(sum(greatest(0,floor(extract(epoch from (coalesce(b.ended_at,now())-b.started_at))/60)::integer)) filter(where not b.counts_as_work),0))::integer as effective_work_minutes,
  case when s.scheduled_minutes is null then null else
   greatest(0,floor(extract(epoch from (coalesce(s.ended_at,now())-s.started_at))/60)::integer -
   coalesce(sum(greatest(0,floor(extract(epoch from (coalesce(b.ended_at,now())-b.started_at))/60)::integer)) filter(where not b.counts_as_work),0))::integer-s.scheduled_minutes end as schedule_delta_minutes,
  case when s.scheduled_start_at is null then null else greatest(0,floor(extract(epoch from (s.started_at-s.scheduled_start_at))/60)::integer) end as lateness_minutes,
  case when s.scheduled_end_at is null or s.ended_at is null then null else greatest(0,floor(extract(epoch from (s.scheduled_end_at-s.ended_at))/60)::integer) end as early_departure_minutes,
  case when s.scheduled_minutes is null then null else greatest(0,
    floor(extract(epoch from (coalesce(s.ended_at,now())-s.started_at))/60)::integer -
    coalesce(sum(greatest(0,floor(extract(epoch from (coalesce(b.ended_at,now())-b.started_at))/60)::integer)) filter(where not b.counts_as_work),0)::integer-s.scheduled_minutes) end as detected_overtime_minutes
 from public.attendance_sessions s left join public.attendance_breaks b on b.company_id=s.company_id and b.session_id=s.id
 group by s.company_id,s.id;

-- All exposed tables have RLS; access is permission-scoped per tenant.
do $$ declare t text; begin
 foreach t in array array['branches','company_memberships','membership_permission_overrides',
 'employees','supervisors','supervisor_branches','authorized_devices','schedule_templates','schedule_template_days',
 'schedule_assignments','labor_rule_sets','break_rules','attendance_sessions','attendance_events','attendance_breaks',
 'attendance_adjustments','overtime_assessments','overtime_authorizations','audit_log'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy tenant_select on public.%I for select to authenticated using (private.has_company_permission(company_id,''company.read''))',t);
 end loop;
end $$;
-- Permission metadata can be read by authenticated users; no client write policies exist.
create policy company_tenant_select on public.companies for select to authenticated
 using (private.has_company_permission(id,'company.read'));
create policy permissions_read on public.permissions for select to authenticated using (auth.uid() is not null);
create policy role_permissions_read on public.role_permissions for select to authenticated using (auth.uid() is not null);
create policy membership_self_read on public.company_memberships for select to authenticated using (user_id=(select auth.uid()));
create policy employees_role_read on public.employees for select to authenticated using (private.has_company_permission(company_id,'employees.read'));
create policy attendance_role_read on public.attendance_sessions for select to authenticated using (private.has_company_permission(company_id,'attendance.read'));
create policy event_role_read on public.attendance_events for select to authenticated using (private.has_company_permission(company_id,'attendance.read'));
create policy breaks_role_read on public.attendance_breaks for select to authenticated using (private.has_company_permission(company_id,'attendance.read'));
create policy audit_admin_read on public.audit_log for select to authenticated using (private.has_company_permission(company_id,'company.manage'));
create policy own_employee_attendance_read on public.attendance_sessions for select to authenticated using (
 exists(select 1 from public.employees e where e.id=attendance_sessions.employee_id
  and e.company_id=attendance_sessions.company_id and e.auth_user_id=(select auth.uid())));
create policy own_events_read on public.attendance_events for select to authenticated using (
 exists(select 1 from public.attendance_sessions s join public.employees e on e.company_id=s.company_id and e.id=s.employee_id
  where s.id=attendance_events.session_id and s.company_id=attendance_events.company_id and e.auth_user_id=(select auth.uid())));
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on all tables in schema public from anon;

-- Totals by company-local work date; callers apply requested date ranges for daily/weekly,
-- anchored biweekly and monthly totals. Legal thresholds live in effective-dated rule sets.
create or replace view public.attendance_period_totals with (security_invoker=true) as
 select company_id,employee_id,local_work_date,
  sum(presence_minutes)::bigint presence_minutes,sum(all_break_minutes)::bigint all_break_minutes,
  sum(non_work_break_minutes)::bigint non_work_break_minutes,sum(effective_work_minutes)::bigint effective_work_minutes,
  sum(coalesce(schedule_delta_minutes,0))::bigint schedule_delta_minutes
 from public.attendance_session_totals group by company_id,employee_id,local_work_date;
