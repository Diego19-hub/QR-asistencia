import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20261018120000_persist_employee_pin_failures.sql", "utf8");
const route = await readFile("src/app/api/attendance/scan/route.ts", "utf8");
const preview = migration.split("create or replace function public.confirm_employee_attendance")[0];
const confirm = migration.split("create or replace function public.confirm_employee_attendance")[1].split("revoke all on function public.scan_employee_attendance")[0];

test("preview and confirmation return failed PIN results so PostgreSQL can commit the lockout", () => {
  for (const body of [preview, confirm]) {
    assert.match(body, /return jsonb_build_object\('pinError',case/);
    assert.doesNotMatch(body, /raise exception 'pin invalid'/);
    assert.match(body, /pin_result:=private\.verify_employee_pin[\s\S]*?return jsonb_build_object\('pinError'/);
  }
});

test("scanner API maps structured PIN rejections to established HTTP statuses", () => {
  assert.match(route, /pin_locked[\s\S]*status: 429[\s\S]*code: "P0001"/);
  assert.match(route, /pin_not_configured[\s\S]*status: 409[\s\S]*code: "23514"/);
  assert.match(route, /pin_invalid[\s\S]*status: 422[\s\S]*code: "22023"/);
  assert.match(route, /pinFailure\(rpcData\.pinError\)/);
  assert.match(route, /headers: \{ "Cache-Control": "no-store" \}/);
  assert.match(route, /Object\.hasOwn\(rpcData, "pinError"\)/);
  assert.match(route, /if \(!pinError\)[\s\S]*status: 503/);
});

test("migration preserves SECURITY DEFINER and scanner execution grants", () => {
  assert.equal((migration.match(/returns jsonb language plpgsql security definer set search_path = ''/g) ?? []).length, 2);
  assert.match(migration, /grant execute on function public\.scan_employee_attendance\(uuid,text,text,text\) to authenticated/);
  assert.match(migration, /grant execute on function public\.confirm_employee_attendance\(uuid,text,text,text,public\.attendance_event_type,uuid,uuid\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function private\.verify_employee_pin/);
  assert.match(migration, /revoke all on function public\.scan_employee_attendance\(uuid,text,text,text\) from public, anon/);
});
