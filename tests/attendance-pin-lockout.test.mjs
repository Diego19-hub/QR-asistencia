import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20261018120000_persist_employee_pin_failures.sql", "utf8");
const optionalPinMigration = await readFile("supabase/migrations/20261107230000_optional_attendance_pin_and_recoverable_qr.sql", "utf8");
const route = await readFile("src/app/api/attendance/scan/route.ts", "utf8");
const companyRoute = await readFile("src/app/api/company/route.ts", "utf8");
const settingsComponent = await readFile("src/components/admin/company-settings.tsx", "utf8");
const scannerComponent = await readFile("src/components/scanner/mobile-scanner.tsx", "utf8");
const preview = migration.split("create or replace function public.confirm_employee_attendance")[0];
const confirm = migration.split("create or replace function public.confirm_employee_attendance")[1].split("revoke all on function public.scan_employee_attendance")[0];

test("preview and confirmation return failed PIN results so PostgreSQL can commit the lockout", () => {
  for (const body of [preview, confirm]) {
    assert.match(body, /return jsonb_build_object\('pinError',case/);
    assert.doesNotMatch(body, /raise exception 'pin invalid'/);
    assert.match(body, /pin_result:=private\.verify_employee_pin[\s\S]*?return jsonb_build_object\('pinError'/);
  }
});

test("PIN policy defaults off and database RPCs skip verification only when company policy is disabled", () => {
  assert.match(optionalPinMigration, /require_employee_pin boolean not null default false/);
  assert.equal((optionalPinMigration.match(/if coalesce\(\(select c\.require_employee_pin[\s\S]*?private\.verify_employee_pin/g) ?? []).length, 2);
  assert.match(route, /pin: z\.string\(\)\.regex\(\/\^\(\?:\\d\{6,12\}\)\?\$\/\)\.default\(""\)/);
});

test("optional PIN migration has a complete outer transaction delimiter", () => {
  const statements = optionalPinMigration.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.equal(statements[2]?.toLowerCase(), "begin;");
  assert.equal(statements.at(-1)?.toLowerCase(), "commit;");
});

test("company PIN policy is read and changed only through company.manage, and UI does not request PIN when off", () => {
  assert.match(companyRoute, /require_employee_pin/);
  assert.match(companyRoute, /checkAdminCompanyPermission\(scope, "company\.manage"\)/);
  assert.match(companyRoute, /requireEmployeePin: z\.boolean\(\)\.optional\(\)/);
  assert.match(settingsComponent, /Solicitar PIN al registrar asistencia/);
  assert.match(scannerComponent, /context\.requireEmployeePin \? <label/);
  assert.match(scannerComponent, /PIN está desactivado para esta empresa/);
});

test("missing attendance-setting schema is reported as a migration prerequisite", () => {
  assert.match(companyRoute, /function isMissingPinSettingColumn/);
  assert.match(companyRoute, /require_employee_pin/i);
  assert.match(companyRoute, /error\.code === "42703" \|\| error\.code === "PGRST204"/);
  assert.match(companyRoute, /company_attendance_settings_migration_required/);
  assert.match(companyRoute, /20261107230000_optional_attendance_pin_and_recoverable_qr\.sql/);
  assert.match(companyRoute, /if \(error\) return companyLookupError\(error\)/);
  assert.match(companyRoute, /if \(isMissingPinSettingColumn\(error\)\) return companyLookupError\(error\)/);
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
