-- A clock-out can close a still-open break so interrupted / forgotten break
-- ends remain visible and auditable instead of blocking the entire shift.
alter table public.attendance_breaks add column is_incomplete boolean not null default false;
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
          (previous_type='break_start' and new.event_type in ('break_end','clock_out')) or
          (previous_type='break_end' and new.event_type in ('break_start','clock_out'))) then
   raise exception 'invalid attendance event transition' using errcode='23514';
  end if;
  new.sequence_no:=coalesce((select max(sequence_no)+1 from public.attendance_events where session_id=new.session_id),1);
 end if;
 return new;
end $$;
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
  if new.metadata->>'break_rule_id' is not null and br.id is null then
   raise exception 'break rule is not effective for this work date' using errcode='23514';
  end if;
  default_counts:=coalesce(br.counts_as_work,false);
  insert into public.attendance_breaks(company_id,session_id,start_event_id,break_rule_id,counts_as_work,started_at)
   values(new.company_id,new.session_id,new.id,br.id,default_counts,new.occurred_at);
 elsif new.event_type='break_end' then
  update public.attendance_breaks set end_event_id=new.id,ended_at=new.occurred_at,is_incomplete=false
   where company_id=new.company_id and session_id=new.session_id and ended_at is null;
 elsif new.event_type='clock_out' then
  update public.attendance_breaks set end_event_id=new.id,ended_at=new.occurred_at,is_incomplete=true
   where company_id=new.company_id and session_id=new.session_id and ended_at is null;
  update public.attendance_sessions set ended_at=new.occurred_at,status='closed'
   where id=new.session_id and company_id=new.company_id;
 end if;
 return new;
end $$;

-- Keep one effective-dated payroll-period definition per company. Quincenas
-- may follow calendar halves or a configurable fixed day interval.
create table public.company_pay_period_rules (
 id uuid primary key default gen_random_uuid(), company_id uuid not null,
 effective_from date not null, effective_to date,
 biweekly_mode text not null check(biweekly_mode in ('calendar_half_month','fixed_days')),
 anchor_date date not null, interval_days smallint not null default 14 check(interval_days between 1 and 31),
 created_at timestamptz not null default now(), unique(company_id,id),
 foreign key(company_id) references public.companies(id) on delete restrict,
 check(effective_to is null or effective_to>=effective_from),
 check(biweekly_mode='calendar_half_month' or anchor_date is not null)
);
create index company_pay_period_rules_effective on public.company_pay_period_rules(company_id,effective_from,effective_to);
alter table public.company_pay_period_rules enable row level security;
grant select on public.company_pay_period_rules to authenticated;
create policy pay_period_rules_read on public.company_pay_period_rules for select to authenticated
 using (private.has_company_permission(company_id,'company.read'));

-- Branch-aware authorization prevents a supervisor's company membership from
-- implicitly granting access to every branch's employee and attendance data.
create or replace function private.can_access_branch(p_company_id uuid,p_branch_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
 select private.has_company_permission(p_company_id,'company.read') or
  (private.has_company_permission(p_company_id,p_permission) and exists(
   select 1 from public.supervisor_branches sb join public.company_memberships m
    on m.company_id=sb.company_id and m.id=sb.membership_id
   where sb.company_id=p_company_id and sb.branch_id=p_branch_id
    and m.user_id=(select auth.uid()) and m.active))
$$;
revoke all on function private.can_access_branch(uuid,uuid,text) from public,anon;
grant execute on function private.can_access_branch(uuid,uuid,text) to authenticated;

drop policy tenant_select on public.branches;
create policy tenant_select on public.branches for select to authenticated
 using (private.can_access_branch(company_id,id,'employees.read'));
drop policy tenant_select on public.employees;
drop policy employees_role_read on public.employees;
create policy employees_scoped_read on public.employees for select to authenticated using (
 private.can_access_branch(company_id,branch_id,'employees.read') or auth_user_id=(select auth.uid()));
drop policy tenant_select on public.attendance_sessions;
drop policy attendance_role_read on public.attendance_sessions;
drop policy own_employee_attendance_read on public.attendance_sessions;
create policy sessions_scoped_read on public.attendance_sessions for select to authenticated using (
 private.can_access_branch(company_id,branch_id,'attendance.read') or exists(
  select 1 from public.employees e where e.company_id=attendance_sessions.company_id
   and e.id=attendance_sessions.employee_id and e.auth_user_id=(select auth.uid())));
drop policy tenant_select on public.attendance_events;
drop policy event_role_read on public.attendance_events;
drop policy own_events_read on public.attendance_events;
create policy events_scoped_read on public.attendance_events for select to authenticated using (
 exists(select 1 from public.attendance_sessions s where s.company_id=attendance_events.company_id
  and s.id=attendance_events.session_id and private.can_access_branch(s.company_id,s.branch_id,'attendance.read')) or exists(
  select 1 from public.attendance_sessions s join public.employees e
   on e.company_id=s.company_id and e.id=s.employee_id
  where s.company_id=attendance_events.company_id and s.id=attendance_events.session_id
   and e.auth_user_id=(select auth.uid())));
drop policy tenant_select on public.attendance_breaks;
drop policy breaks_role_read on public.attendance_breaks;
create policy breaks_scoped_read on public.attendance_breaks for select to authenticated using (
 exists(select 1 from public.attendance_sessions s where s.company_id=attendance_breaks.company_id
  and s.id=attendance_breaks.session_id and private.can_access_branch(s.company_id,s.branch_id,'attendance.read')) or exists(
  select 1 from public.attendance_sessions s join public.employees e on e.company_id=s.company_id and e.id=s.employee_id
  where s.company_id=attendance_breaks.company_id and s.id=attendance_breaks.session_id and e.auth_user_id=(select auth.uid())));
drop policy tenant_select on public.company_memberships;
drop policy tenant_select on public.audit_log;
drop policy audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select to authenticated
 using (private.has_company_permission(company_id,'company.manage'));

drop policy permissions_read on public.permissions;
create policy permissions_read on public.permissions for select to authenticated using ((select auth.uid()) is not null);
drop policy role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated using ((select auth.uid()) is not null);

-- Materialized aggregates are intentionally query-time views so late edits and
-- incomplete breaks are reflected. detected overtime remains separate from approval.
drop view public.attendance_period_totals;
create view public.attendance_period_totals with (security_invoker=true) as
 with daily as (
  select company_id,employee_id,local_work_date,
   sum(presence_minutes)::bigint presence_minutes,sum(all_break_minutes)::bigint all_break_minutes,
   sum(non_work_break_minutes)::bigint non_work_break_minutes,sum(effective_work_minutes)::bigint effective_work_minutes,
   sum(coalesce(schedule_delta_minutes,0))::bigint schedule_delta_minutes,
   sum(coalesce(lateness_minutes,0))::bigint lateness_minutes,
   sum(coalesce(early_departure_minutes,0))::bigint early_departure_minutes,
   sum(coalesce(detected_overtime_minutes,0))::bigint detected_overtime_minutes
  from public.attendance_session_totals group by company_id,employee_id,local_work_date
 ), periods as (
  select 'daily'::text period_type,d.company_id,d.employee_id,d.local_work_date period_start,d.local_work_date period_end,
   d.presence_minutes,d.all_break_minutes,d.non_work_break_minutes,d.effective_work_minutes,d.schedule_delta_minutes,
   d.lateness_minutes,d.early_departure_minutes,d.detected_overtime_minutes from daily d
  union all
  select 'weekly',d.company_id,d.employee_id,date_trunc('week',d.local_work_date)::date,date_trunc('week',d.local_work_date)::date+6,
   d.presence_minutes,d.all_break_minutes,d.non_work_break_minutes,d.effective_work_minutes,d.schedule_delta_minutes,
   d.lateness_minutes,d.early_departure_minutes,d.detected_overtime_minutes from daily d
  union all
  select 'monthly',d.company_id,d.employee_id,date_trunc('month',d.local_work_date)::date,
   (date_trunc('month',d.local_work_date)+interval '1 month'-interval '1 day')::date,
   d.presence_minutes,d.all_break_minutes,d.non_work_break_minutes,d.effective_work_minutes,d.schedule_delta_minutes,
   d.lateness_minutes,d.early_departure_minutes,d.detected_overtime_minutes from daily d
  union all
  select 'biweekly',d.company_id,d.employee_id,bounds.period_start,bounds.period_end,
   d.presence_minutes,d.all_break_minutes,d.non_work_break_minutes,d.effective_work_minutes,d.schedule_delta_minutes,
   d.lateness_minutes,d.early_departure_minutes,d.detected_overtime_minutes from daily d
   join public.company_pay_period_rules r on r.company_id=d.company_id
    and r.effective_from<=d.local_work_date and (r.effective_to is null or r.effective_to>=d.local_work_date)
   cross join lateral (select case when r.biweekly_mode='calendar_half_month' then
     case when extract(day from d.local_work_date)<=15 then date_trunc('month',d.local_work_date)::date
      else date_trunc('month',d.local_work_date)::date+15 end
     else r.anchor_date + (floor((d.local_work_date-r.anchor_date)::numeric/r.interval_days)::integer*r.interval_days) end as period_start,
    case when r.biweekly_mode='calendar_half_month' then
     case when extract(day from d.local_work_date)<=15 then date_trunc('month',d.local_work_date)::date+14
      else (date_trunc('month',d.local_work_date)+interval '1 month'-interval '1 day')::date end
     else r.anchor_date + (floor((d.local_work_date-r.anchor_date)::numeric/r.interval_days)::integer*r.interval_days)+r.interval_days-1 end as period_end) bounds
 )
 select period_type,company_id,employee_id,period_start,period_end,
  sum(presence_minutes)::bigint presence_minutes,sum(all_break_minutes)::bigint all_break_minutes,
  sum(non_work_break_minutes)::bigint non_work_break_minutes,sum(effective_work_minutes)::bigint effective_work_minutes,
  sum(schedule_delta_minutes)::bigint schedule_delta_minutes,sum(lateness_minutes)::bigint lateness_minutes,
  sum(early_departure_minutes)::bigint early_departure_minutes,sum(detected_overtime_minutes)::bigint detected_overtime_minutes
 from periods group by period_type,company_id,employee_id,period_start,period_end;
revoke all on public.attendance_session_totals,public.attendance_period_totals from public,anon;
grant select on public.attendance_session_totals,public.attendance_period_totals to authenticated;
