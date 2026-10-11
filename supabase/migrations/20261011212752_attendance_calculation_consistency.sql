-- Snapshot the effective entry and exit tolerances for each new session.
-- Existing sessions remain untouched and keep NULL to indicate no saved snapshot.
alter table public.attendance_sessions
  add column late_tolerance_minutes smallint
    check (late_tolerance_minutes between 0 and 1440),
  add column early_departure_tolerance_minutes smallint
    check (early_departure_tolerance_minutes between 0 and 1440);

-- Use seconds until the final conversion to minutes. Flooring each break before
-- subtracting it loses time when fractional minutes occur in separate intervals.
create or replace view public.attendance_session_totals
with (security_invoker = true) as
with session_seconds as (
  select
    s.company_id,
    s.id as session_id,
    s.employee_id,
    s.branch_id,
    s.assignment_id,
    s.local_work_date,
    s.timezone,
    s.status,
    s.started_at,
    s.ended_at,
    s.scheduled_start_at,
    s.scheduled_end_at,
    s.scheduled_minutes,
    s.late_tolerance_minutes,
    s.early_departure_tolerance_minutes,
    greatest(0::numeric, extract(epoch from (coalesce(s.ended_at, statement_timestamp()) - s.started_at))) as presence_seconds,
    coalesce(break_totals.all_break_seconds, 0::numeric) as all_break_seconds,
    coalesce(break_totals.non_work_break_seconds, 0::numeric) as non_work_break_seconds,
    coalesce(break_totals.has_incomplete_breaks, false) as has_incomplete_breaks
  from public.attendance_sessions s
  left join lateral (
    select
      sum(greatest(0::numeric, extract(epoch from (coalesce(b.ended_at, statement_timestamp()) - b.started_at)))) as all_break_seconds,
      sum(greatest(0::numeric, extract(epoch from (coalesce(b.ended_at, statement_timestamp()) - b.started_at))))
        filter (where not b.counts_as_work) as non_work_break_seconds,
      bool_or(b.is_incomplete) as has_incomplete_breaks
    from public.attendance_breaks b
    where b.company_id = s.company_id and b.session_id = s.id
  ) break_totals on true
)
select
  company_id,
  session_id,
  employee_id,
  local_work_date,
  timezone,
  status,
  started_at,
  ended_at,
  scheduled_minutes,
  floor(presence_seconds / 60)::integer as presence_minutes,
  floor(non_work_break_seconds / 60)::integer as non_work_break_minutes,
  floor(all_break_seconds / 60)::integer as all_break_minutes,
  floor(greatest(0::numeric, presence_seconds - non_work_break_seconds) / 60)::integer as effective_work_minutes,
  case when scheduled_minutes is null then null
       else floor(greatest(0::numeric, presence_seconds - non_work_break_seconds) / 60)::integer - scheduled_minutes
  end as schedule_delta_minutes,
  case when scheduled_start_at is null then null
       else floor(greatest(0::numeric,
         extract(epoch from (started_at - scheduled_start_at)) - coalesce(late_tolerance_minutes, 0)::numeric * 60
       ) / 60)::integer
  end as lateness_minutes,
  case when scheduled_end_at is null or ended_at is null then null
       else floor(greatest(0::numeric,
         extract(epoch from (scheduled_end_at - ended_at)) - coalesce(early_departure_tolerance_minutes, 0)::numeric * 60
       ) / 60)::integer
  end as early_departure_minutes,
  case when scheduled_minutes is null then null
       else greatest(0, floor(greatest(0::numeric, presence_seconds - non_work_break_seconds) / 60)::integer - scheduled_minutes)
  end as detected_overtime_minutes,
  scheduled_start_at,
  scheduled_end_at,
  late_tolerance_minutes,
  early_departure_tolerance_minutes,
  branch_id,
  assignment_id,
  has_incomplete_breaks
from session_seconds;

-- Keep schedule and authorization validation intact while recording the
-- effective-dated schedule and labor-rule tolerances as part of the snapshot.
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
