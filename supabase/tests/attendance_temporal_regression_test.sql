-- Deterministic temporal regression cases for attendance calculations.
-- Uses fixed local wall times and converts them through PostgreSQL's IANA zones.
BEGIN;
SELECT plan(13);

SELECT is(floor(extract(epoch from (
  ((date '2026-01-15' + time '17:00') at time zone 'America/Mexico_City') -
  ((date '2026-01-15' + time '09:00') at time zone 'America/Mexico_City'))) / 60)::integer,
  480, 'normal eight-hour shift uses elapsed minutes in the branch timezone');

SELECT is(floor(extract(epoch from (
  (timestamptz '2026-01-15 13:30:00-06') -
  ((date '2026-01-15' + time '09:00') at time zone 'America/Mexico_City'))) / 60)::integer,
  270, 'incomplete shift uses a fixed as-of instant for deterministic elapsed time');

SELECT is(floor(extract(epoch from (
  ((date '2026-01-15' + time '17:00') at time zone 'America/Mexico_City') -
  ((date '2026-01-15' + time '09:00') at time zone 'America/Mexico_City'))) / 60)::integer,
  480, 'presence for a complete normal shift is 480 minutes');

SELECT is(floor(extract(epoch from (time '13:00' - time '12:00')) / 60)::integer,
  60, 'a one-hour unpaid break is measured as 60 minutes');
SELECT is(480 - 60, 420, 'one unpaid break reduces effective work to 420 minutes');
SELECT is(480 - 0, 480, 'a break counted as work does not reduce effective work');

SELECT is(greatest(0, 10 - 15), 0, 'arrival within the 15-minute tolerance is not late');
SELECT is(greatest(0, 16 - 15), 1, 'arrival one minute beyond tolerance records one late minute');
SELECT is(greatest(0, 10 - 10), 0, 'departure within a 10-minute tolerance is not early');
SELECT is(greatest(0, 16 - 10), 6, 'early departure subtracts the configured 10-minute tolerance');

SELECT is(floor(extract(epoch from (
  ((date '2026-01-16' + time '06:00') at time zone 'America/Mexico_City') -
  ((date '2026-01-15' + time '22:00') at time zone 'America/Mexico_City'))) / 60)::integer,
  480, 'overnight shift crosses local midnight and remains eight hours in Mexico City');

SELECT is(floor(extract(epoch from (
  ((date '2026-03-08' + time '04:00') at time zone 'America/Tijuana') -
  ((date '2026-03-08' + time '01:00') at time zone 'America/Tijuana'))) / 60)::integer,
  120, 'spring DST transition measures real elapsed time across the skipped hour');
SELECT is(floor(extract(epoch from (
  ((date '2026-11-01' + time '03:00') at time zone 'America/Tijuana') -
  ((date '2026-11-01' + time '00:00') at time zone 'America/Tijuana'))) / 60)::integer,
  240, 'autumn DST transition measures real elapsed time across the repeated hour');

SELECT * FROM finish();
ROLLBACK;
