-- Behavioral calculations and tenant isolation using synthetic rows only.
-- The caller runs this file inside a transaction and rolls it back.
BEGIN;
SELECT plan(27);

CREATE TEMP TABLE test_sessions (test_key text primary key, session_id uuid not null);

-- Synthetic Auth identities and two isolated tenants.
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
 ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'etapa7-a@example.invalid', '', clock_timestamp(), clock_timestamp(), clock_timestamp()),
 ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'etapa7-b@example.invalid', '', clock_timestamp(), clock_timestamp(), clock_timestamp());

INSERT INTO public.companies (id, name) VALUES
 ('20000000-0000-4000-8000-000000000001', 'Etapa 7 test tenant A'),
 ('20000000-0000-4000-8000-000000000002', 'Etapa 7 test tenant B');
INSERT INTO public.branches (id, company_id, name, timezone) VALUES
 ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Test A', 'America/Mexico_City'),
 ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Test B', 'America/Mexico_City');
INSERT INTO public.employees (id, company_id, branch_id, employee_number, first_name, last_name) VALUES
 ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'TEST-A', 'Fixture', 'Uno'),
 ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'TEST-B', 'Fixture', 'Dos');
INSERT INTO public.company_memberships (id, company_id, user_id, role, active) VALUES
 ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'admin', true),
 ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'admin', true);
INSERT INTO public.supervisors (company_id, membership_id) VALUES
 ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001');
INSERT INTO public.supervisor_branches (company_id, membership_id, branch_id) VALUES
 ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
INSERT INTO public.authorized_devices (id, company_id, branch_id, membership_id, label) VALUES
 ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Test fixture device');
INSERT INTO public.break_rules (id, company_id, code, name, effective_from, counts_as_work, required) VALUES
 ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'test-paid', 'Test paid meal', '2026-01-01', true, false),
 ('70000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'test-unpaid', 'Test unpaid meal', '2026-01-01', false, false);

CREATE FUNCTION pg_temp.open_test_session(
  p_key text, p_local_date date, p_scheduled_start timestamptz,
  p_scheduled_end timestamptz, p_scheduled_minutes integer,
  p_late_tolerance integer, p_early_tolerance integer
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.attendance_sessions (
    id, company_id, employee_id, branch_id, local_work_date, timezone,
    scheduled_start_at, scheduled_end_at, scheduled_minutes,
    late_tolerance_minutes, early_departure_tolerance_minutes
  ) VALUES (
    v_id, '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001', p_local_date,
    'America/Mexico_City', p_scheduled_start, p_scheduled_end,
    p_scheduled_minutes, p_late_tolerance::smallint, p_early_tolerance::smallint
  );
  INSERT INTO pg_temp.test_sessions(test_key, session_id) VALUES (p_key, v_id);
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.test_event(
  p_key text, p_type public.attendance_event_type,
  p_at timestamptz, p_break_rule uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.attendance_events (
    company_id, session_id, event_type, recorded_by, device_id,
    idempotency_key, occurred_at, metadata
  ) VALUES (
    '20000000-0000-4000-8000-000000000001',
    (SELECT session_id FROM pg_temp.test_sessions WHERE test_key=p_key),
    p_type, '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001', gen_random_uuid(), p_at,
    CASE WHEN p_break_rule IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('break_rule_id', p_break_rule) END
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Paid meal: 09:00-17:00 presence, with 13:00-14:00 paid.
SELECT pg_temp.open_test_session('paid', '2026-01-05', ('2026-01-05 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'), ('2026-01-05 17:00'::timestamp AT TIME ZONE 'America/Mexico_City'), 480, 15, 15);
SELECT pg_temp.test_event('paid', 'clock_in', ('2026-01-05 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('paid', 'break_start', ('2026-01-05 13:00'::timestamp AT TIME ZONE 'America/Mexico_City'), '70000000-0000-4000-8000-000000000001');
SELECT pg_temp.test_event('paid', 'break_end', ('2026-01-05 14:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('paid', 'clock_out', ('2026-01-05 17:00'::timestamp AT TIME ZONE 'America/Mexico_City'));

-- Unpaid meal: schedule minutes correctly exclude its 60 minutes.
SELECT pg_temp.open_test_session('unpaid', '2026-01-06', ('2026-01-06 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'), ('2026-01-06 17:00'::timestamp AT TIME ZONE 'America/Mexico_City'), 420, 15, 15);
SELECT pg_temp.test_event('unpaid', 'clock_in', ('2026-01-06 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('unpaid', 'break_start', ('2026-01-06 13:00'::timestamp AT TIME ZONE 'America/Mexico_City'), '70000000-0000-4000-8000-000000000002');
SELECT pg_temp.test_event('unpaid', 'break_end', ('2026-01-06 14:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('unpaid', 'clock_out', ('2026-01-06 17:00'::timestamp AT TIME ZONE 'America/Mexico_City'));

-- A 15-minute tolerance leaves only the minute beyond it as late.
SELECT pg_temp.open_test_session('late', '2026-01-07', ('2026-01-07 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'), ('2026-01-07 17:00'::timestamp AT TIME ZONE 'America/Mexico_City'), 480, 15, 15);
SELECT pg_temp.test_event('late', 'clock_in', ('2026-01-07 09:16'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('late', 'clock_out', ('2026-01-07 17:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.open_test_session('early', '2026-01-08', ('2026-01-08 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'), ('2026-01-08 17:00'::timestamp AT TIME ZONE 'America/Mexico_City'), 480, 15, 15);
SELECT pg_temp.test_event('early', 'clock_in', ('2026-01-08 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('early', 'clock_out', ('2026-01-08 16:44'::timestamp AT TIME ZONE 'America/Mexico_City'));

-- Overnight schedule resolves its end on the next local date.
SELECT pg_temp.open_test_session('night', '2026-01-09', ('2026-01-09 22:00'::timestamp AT TIME ZONE 'America/Mexico_City'), ('2026-01-10 06:00'::timestamp AT TIME ZONE 'America/Mexico_City'), 480, 0, 0);
SELECT pg_temp.test_event('night', 'clock_in', ('2026-01-09 22:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('night', 'clock_out', ('2026-01-10 06:00'::timestamp AT TIME ZONE 'America/Mexico_City'));

-- A Sunday with no schedule retains actual time but has no schedule overtime.
SELECT pg_temp.open_test_session('unscheduled', '2026-01-11', NULL, NULL, NULL, NULL, NULL);
SELECT pg_temp.test_event('unscheduled', 'clock_in', ('2026-01-11 12:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('unscheduled', 'clock_out', ('2026-01-11 13:00'::timestamp AT TIME ZONE 'America/Mexico_City'));

-- One hour over the schedule is detected separately from 30 minutes approved.
SELECT pg_temp.open_test_session('overtime', '2026-01-12', ('2026-01-12 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'), ('2026-01-12 17:00'::timestamp AT TIME ZONE 'America/Mexico_City'), 480, 0, 0);
SELECT pg_temp.test_event('overtime', 'clock_in', ('2026-01-12 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('overtime', 'clock_out', ('2026-01-12 18:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
INSERT INTO public.overtime_authorizations (company_id, session_id, minutes, status, requested_by, decided_by, reason, decided_at)
SELECT '20000000-0000-4000-8000-000000000001', session_id, 30, 'approved',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Synthetic test approval', clock_timestamp()
FROM pg_temp.test_sessions WHERE test_key='overtime';

-- A clock-out during an unpaid break closes it as incomplete, not as complete.
SELECT pg_temp.open_test_session('incomplete', '2026-01-13', ('2026-01-13 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'), ('2026-01-13 17:00'::timestamp AT TIME ZONE 'America/Mexico_City'), 420, 0, 0);
SELECT pg_temp.test_event('incomplete', 'clock_in', ('2026-01-13 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('incomplete', 'break_start', ('2026-01-13 13:00'::timestamp AT TIME ZONE 'America/Mexico_City'), '70000000-0000-4000-8000-000000000002');
SELECT pg_temp.test_event('incomplete', 'clock_out', ('2026-01-13 17:00'::timestamp AT TIME ZONE 'America/Mexico_City'));

-- Two 35-second unpaid rests exercise the final-rounding behavior in the view.
SELECT pg_temp.open_test_session('fractional', '2026-01-14', NULL, NULL, NULL, NULL, NULL);
SELECT pg_temp.test_event('fractional', 'clock_in', ('2026-01-14 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'));
SELECT pg_temp.test_event('fractional', 'break_start', ('2026-01-14 09:01'::timestamp AT TIME ZONE 'America/Mexico_City'), '70000000-0000-4000-8000-000000000002');
SELECT pg_temp.test_event('fractional', 'break_end', (('2026-01-14 09:01'::timestamp AT TIME ZONE 'America/Mexico_City') + interval '35 seconds'));
SELECT pg_temp.test_event('fractional', 'break_start', ('2026-01-14 09:02'::timestamp AT TIME ZONE 'America/Mexico_City'), '70000000-0000-4000-8000-000000000002');
SELECT pg_temp.test_event('fractional', 'break_end', (('2026-01-14 09:02'::timestamp AT TIME ZONE 'America/Mexico_City') + interval '35 seconds'));
SELECT pg_temp.test_event('fractional', 'clock_out', (('2026-01-14 09:00'::timestamp AT TIME ZONE 'America/Mexico_City') + interval '605 seconds'));

-- Separate tenant B row verifies visibility using authenticated RLS claims.
INSERT INTO public.attendance_sessions (company_id, employee_id, branch_id, local_work_date, timezone, status, started_at, ended_at)
VALUES ('20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002', '2026-01-12', 'America/Mexico_City', 'closed',
  ('2026-01-12 09:00'::timestamp AT TIME ZONE 'America/Mexico_City'),
  ('2026-01-12 10:00'::timestamp AT TIME ZONE 'America/Mexico_City'));

SELECT is((SELECT presence_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='paid')), 480, 'real paid-break session has 480 presence minutes');
SELECT is((SELECT all_break_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='paid')), 60, 'paid meal duration is still recorded');
SELECT is((SELECT non_work_break_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='paid')), 0, 'paid meal is not deducted');
SELECT is((SELECT effective_work_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='paid')), 480, 'paid meal session computes 480 effective minutes');
SELECT is((SELECT effective_work_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='unpaid')), 420, 'unpaid meal session computes 420 effective minutes');
SELECT is((SELECT schedule_delta_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='unpaid')), 0, 'unpaid meal schedule comparison uses 420 scheduled minutes');
SELECT is((SELECT lateness_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='late')), 1, 'real session applies the 15-minute late tolerance once');
SELECT is((SELECT early_departure_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='early')), 1, 'real session applies the 15-minute early-departure tolerance once');
SELECT is((SELECT presence_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='night')), 480, 'real overnight session computes eight hours');
SELECT is((SELECT ((scheduled_end_at AT TIME ZONE timezone)::date - (scheduled_start_at AT TIME ZONE timezone)::date) FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='night')), 1, 'overnight schedule end is the next local date');
SELECT is((SELECT detected_overtime_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='unscheduled')), NULL::integer, 'unscheduled real session has no detected schedule overtime');
SELECT is((SELECT effective_work_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='unscheduled')), 60, 'unscheduled session keeps its actual worked time');
SELECT is((SELECT detected_overtime_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='overtime')), 60, 'one-hour overtime is detected');
SELECT is((SELECT sum(minutes)::integer FROM public.overtime_authorizations WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='overtime') AND status='approved'), 30, 'approved overtime remains a separate 30-minute amount');
SELECT ok((SELECT has_incomplete_breaks FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='incomplete')), 'unfinished break is flagged incomplete');
SELECT is((SELECT effective_work_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='incomplete')), 240, 'incomplete unpaid break time is not counted as work');
SELECT is((SELECT presence_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='fractional')), 10, 'fractional-rest session presence rounds once to ten minutes');
SELECT is((SELECT non_work_break_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='fractional')), 1, 'fractional rests total seventy seconds');
SELECT is((SELECT effective_work_minutes FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='fractional')), 8, 'fractional unpaid rests are subtracted before final rounding');
INSERT INTO public.company_pay_period_rules (id, company_id, effective_from, biweekly_mode, anchor_date)
VALUES ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '2026-01-01', 'calendar_half_month', '2026-01-01');
SELECT is((SELECT effective_work_minutes::bigint FROM public.attendance_period_totals WHERE period_type='daily' AND company_id='20000000-0000-4000-8000-000000000001' AND employee_id='40000000-0000-4000-8000-000000000001' AND period_start='2026-01-05'),
  (SELECT effective_work_minutes::bigint FROM public.attendance_session_totals WHERE session_id=(SELECT session_id FROM test_sessions WHERE test_key='paid')),
  'daily report total matches the detailed attendance row');
SELECT is((SELECT effective_work_minutes FROM public.attendance_period_totals WHERE period_type='weekly' AND company_id='20000000-0000-4000-8000-000000000001' AND employee_id='40000000-0000-4000-8000-000000000001' AND period_start='2026-01-05'),
  (SELECT sum(effective_work_minutes) FROM public.attendance_session_totals WHERE company_id='20000000-0000-4000-8000-000000000001' AND employee_id='40000000-0000-4000-8000-000000000001' AND local_work_date BETWEEN '2026-01-05' AND '2026-01-11'),
  'weekly report total matches the sum of daily rows');
SELECT is((SELECT effective_work_minutes FROM public.attendance_period_totals WHERE period_type='biweekly' AND company_id='20000000-0000-4000-8000-000000000001' AND employee_id='40000000-0000-4000-8000-000000000001' AND period_start='2026-01-01'),
  (SELECT sum(effective_work_minutes) FROM public.attendance_session_totals WHERE company_id='20000000-0000-4000-8000-000000000001' AND employee_id='40000000-0000-4000-8000-000000000001' AND local_work_date BETWEEN '2026-01-01' AND '2026-01-15'),
  'biweekly report follows the effective calendar-half payroll rule');
SELECT is((SELECT effective_work_minutes FROM public.attendance_period_totals WHERE period_type='monthly' AND company_id='20000000-0000-4000-8000-000000000001' AND employee_id='40000000-0000-4000-8000-000000000001' AND period_start='2026-01-01'),
  (SELECT sum(effective_work_minutes) FROM public.attendance_session_totals WHERE company_id='20000000-0000-4000-8000-000000000001' AND employee_id='40000000-0000-4000-8000-000000000001' AND local_work_date BETWEEN '2026-01-01' AND '2026-01-31'),
  'monthly report total matches the sum of daily rows');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::integer FROM public.attendance_session_totals), 9, 'tenant A administrator sees only its nine sessions');
SELECT is((SELECT count(*)::integer FROM public.attendance_session_totals WHERE company_id='20000000-0000-4000-8000-000000000002'), 0, 'tenant A administrator cannot read tenant B sessions');
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::integer FROM public.attendance_session_totals), 1, 'tenant B administrator sees its one session only');
SELECT is((SELECT count(*)::integer FROM public.attendance_session_totals WHERE company_id='20000000-0000-4000-8000-000000000001'), 0, 'tenant B administrator cannot read tenant A sessions');

SELECT * FROM finish();
ROLLBACK;
