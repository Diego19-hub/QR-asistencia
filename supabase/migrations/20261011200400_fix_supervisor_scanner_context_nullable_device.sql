-- Keep the scanner context usable before a device has been authorized.
-- Explicitly initialized UUIDs represent the empty result of scanner_device.
create or replace function public.get_supervisor_scanner_context(
  p_company_id uuid,
  p_device_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mid uuid;
  dev_device_id uuid := null;
  dev_branch_id uuid := null;
  payload jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  select m.id into mid
    from public.company_memberships m
    join public.supervisors s
      on s.company_id=m.company_id and s.membership_id=m.id
   where m.company_id=p_company_id
     and m.user_id=(select auth.uid())
     and m.role='supervisor'
     and m.active
     and private.has_company_permission(m.company_id,'attendance.scan');

  if mid is null then
    raise exception 'supervisor required' using errcode='42501';
  end if;

  if p_device_token is not null then
    select sd.device_id, sd.branch_id
      into dev_device_id, dev_branch_id
      from private.scanner_device(p_company_id,p_device_token) sd
     where sd.membership_id=mid
     limit 1;
  end if;

  select jsonb_build_object(
    'companyId',c.id,
    'companyName',c.name,
    'supervisorName',coalesce(nullif(trim(concat_ws(' ',e.first_name,e.last_name)),''),u.email),
    'authorized',dev_device_id is not null,
    'deviceId',dev_device_id,
    'branchId',dev_branch_id,
    'branchName',db.name,
    'timezone',db.timezone,
    'branches',coalesce((
      select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'timezone',b.timezone) order by b.name)
        from public.supervisor_branches sb
        join public.branches b on b.company_id=sb.company_id and b.id=sb.branch_id
       where sb.company_id=c.id and sb.membership_id=mid and b.active
    ),'[]'::jsonb)
  ) into payload
  from public.companies c
  join public.company_memberships m on m.company_id=c.id and m.id=mid
  join auth.users u on u.id=m.user_id
  left join public.supervisors s on s.company_id=m.company_id and s.membership_id=m.id
  left join public.employees e on e.company_id=s.company_id and e.id=s.employee_id
  left join public.branches db on db.company_id=c.id and db.id=dev_branch_id
  where c.id=p_company_id;

  if dev_device_id is not null then
    select payload || jsonb_build_object('recentMovements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeName',x.employee_name,
        'eventType',x.event_type,
        'occurredAt',x.occurred_at
      ) order by x.occurred_at desc)
      from (
        select trim(concat_ws(' ',e.first_name,e.last_name)) as employee_name,
               ev.event_type,
               ev.occurred_at
          from public.attendance_events ev
          join public.attendance_sessions s on s.company_id=ev.company_id and s.id=ev.session_id
          join public.employees e on e.company_id=s.company_id and e.id=s.employee_id
         where ev.company_id=p_company_id
           and ev.recorded_by=(select auth.uid())
           and ev.device_id=dev_device_id
           and ev.occurred_at>=clock_timestamp()-interval '7 days'
         order by ev.occurred_at desc
         limit 10
      ) x
    ),'[]'::jsonb)) into payload;
  else
    payload:=payload || jsonb_build_object('recentMovements','[]'::jsonb);
  end if;

  return payload;
end
$$;
