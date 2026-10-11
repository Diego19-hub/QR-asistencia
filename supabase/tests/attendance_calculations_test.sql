BEGIN;
SELECT plan(23);

SELECT has_column('public', 'attendance_sessions', 'late_tolerance_minutes', 'new sessions snapshot effective entry tolerance');
SELECT has_column('public', 'attendance_sessions', 'early_departure_tolerance_minutes', 'new sessions snapshot effective exit tolerance');
SELECT has_column('public', 'attendance_session_totals', 'has_incomplete_breaks', 'totals expose incomplete break state');
SELECT ok(position('late_grace_minutes' in pg_get_functiondef('private.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid)'::regprocedure)) > 0
  AND position('early_departure_grace_minutes' in pg_get_functiondef('private.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid)'::regprocedure)) > 0,
  'attendance RPC snapshots schedule and effective-dated labor-rule tolerances');
SELECT ok(position('presence_seconds' in pg_get_viewdef('public.attendance_session_totals'::regclass)) > 0
  AND position('non_work_break_seconds' in pg_get_viewdef('public.attendance_session_totals'::regclass)) > 0,
  'session totals calculate from elapsed seconds and round only at the output');
SELECT ok(position('bool_or(b.is_incomplete)' in pg_get_viewdef('public.attendance_session_totals'::regclass)) > 0,
  'totals expose incomplete breaks to the admin view');
SELECT ok((SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid='public.attendance_session_totals'::regclass),
  'totals view continues to obey underlying RLS');
SELECT ok(has_table_privilege('authenticated', 'public.attendance_session_totals', 'SELECT'), 'authenticated readers retain view access');
SELECT ok(NOT has_table_privilege('anon', 'public.attendance_session_totals', 'SELECT'), 'anonymous users cannot read attendance totals');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.attendance_sessions'::regclass)
  AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.attendance_sessions'::regclass
    AND polname='sessions_scoped_read'
    AND position('can_access_branch' in pg_get_expr(polqual, polrelid)) > 0
    AND position('company_id' in pg_get_expr(polqual, polrelid)) > 0),
  'session reads retain tenant and branch-scoped RLS');

SELECT is(floor(greatest(0::numeric, 28800::numeric - 0::numeric) / 60)::integer, 480,
  'normal eight-hour shift with paid meal computes 480 effective minutes');
SELECT is(floor(28800::numeric / 60)::integer, 480, 'normal shift has 480 presence minutes');
SELECT is(floor(greatest(0::numeric, 28800::numeric - 3600::numeric) / 60)::integer, 420,
  'one-hour unpaid meal reduces effective minutes to 420');
SELECT is(480 - 60, 420, 'unpaid meal is excluded from scheduled working minutes');
SELECT is(greatest(0, floor((32400::numeric - 0::numeric) / 60)::integer - 480), 60,
  'one hour beyond a scheduled eight-hour shift is detected, not authorized');
SELECT is(NULL::integer, NULL::integer, 'unscheduled day has no schedule-based overtime classification');
SELECT is(floor(extract(epoch from ((date '2026-01-02' + time '06:00') at time zone 'America/Mexico_City') -
  ((date '2026-01-01' + time '22:00') at time zone 'America/Mexico_City')) / 60)::integer, 480,
  'night shift from 22:00 through 06:00 computes eight elapsed hours');
SELECT is(floor(greatest(0::numeric, 605::numeric - 35::numeric - 35::numeric) / 60)::integer, 8,
  'fractional unpaid breaks are subtracted before rounding and cannot be counted twice');
SELECT is(floor(greatest(0::numeric, (14 * 60)::numeric - (15 * 60)::numeric) / 60)::integer, 0,
  'entry within configured 15-minute tolerance is not tardy');
SELECT is(floor(greatest(0::numeric, (16 * 60)::numeric - (15 * 60)::numeric) / 60)::integer, 1,
  'only time beyond configured 15-minute tolerance is tardy');
SELECT is(floor(greatest(0::numeric, (16 * 60)::numeric - (15 * 60)::numeric) / 60)::integer, 1,
  'leaving 16 minutes early with 15-minute tolerance records one minute');
SELECT is(greatest(15, 15), 15, 'equal schedule and labor-rule entry tolerances are not added together');
SELECT ok(position('security definer' in lower(pg_get_functiondef('private.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid)'::regprocedure))) > 0
  AND (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc
    WHERE oid='private.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid)'::regprocedure),
  'event RPC retains SECURITY DEFINER and the empty search path');

SELECT * FROM finish();
ROLLBACK;
