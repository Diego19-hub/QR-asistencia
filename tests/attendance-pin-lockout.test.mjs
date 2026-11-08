import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20261018120000_persist_employee_pin_failures.sql", "utf8");
const optionalPinMigration = await readFile("supabase/migrations/20261107211000_optional_employee_pin_requirement.sql", "utf8");
const revokeCipherMigration = await readFile("supabase/migrations/20261107230000_optional_attendance_pin_and_recoverable_qr.sql", "utf8");
const route = await readFile("src/app/api/attendance/scan/route.ts", "utf8");
const companyRoute = await readFile("src/app/api/company/route.ts", "utf8");
const scannerContextRoute = await readFile("src/app/api/supervisor/scanner/context/route.ts", "utf8");
const companySettings = await readFile("src/components/admin/company-settings.tsx", "utf8");
const scanner = await readFile("src/components/scanner/mobile-scanner.tsx", "utf8");
const preview = optionalPinMigration.split("create or replace function public.confirm_employee_attendance")[0];
const confirm = optionalPinMigration.split("create or replace function public.confirm_employee_attendance")[1].split("revoke all on function public.scan_employee_attendance")[0];

test("preview and confirmation return failed PIN results so PostgreSQL can commit the lockout", () => {
  for (const body of [preview, confirm]) {
    assert.match(body, /return jsonb_build_object\('pinError',case/);
    assert.doesNotMatch(body, /raise exception 'pin invalid'/);
    assert.match(body, /pin_result:=private\.verify_employee_pin[\s\S]*?return jsonb_build_object\('pinError'/);
  }
});

test("PIN is opt-in for existing companies; company setting defaults false and both RPCs consult it", () => {
  assert.match(optionalPinMigration, /add column require_employee_pin boolean not null default false/i);
  assert.equal((optionalPinMigration.match(/if require_pin then/g) ?? []).length, 2);
  assert.equal((optionalPinMigration.match(/private\.verify_employee_pin\(p_company_id,emp,p_pin\)/g) ?? []).length, 2);
  assert.equal((optionalPinMigration.match(/select c\.require_employee_pin into require_pin[\s\S]{0,160}if require_pin then/g) ?? []).length, 2);
  assert.match(route, /pin: z\.string\(\)\.regex\(\/\^\(\?:\\d\{6,12\}\)\?\$\/\)\.default\(""\)/);
});

test("canonical PIN policy migration has balanced outer transaction delimiters", () => {
  const statements = optionalPinMigration.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.equal(statements[1]?.toLowerCase(), "begin;");
  assert.equal(statements.at(-1)?.toLowerCase(), "commit;");
});

test("company PIN policy is protected by company.manage and scanner hides the field only when disabled", () => {
  assert.match(companyRoute, /require_employee_pin/);
  assert.match(companyRoute, /checkAdminCompanyPermission\(scope, "company\.manage"\)/);
  assert.match(companyRoute, /requireEmployeePin: z\.boolean\(\)\.optional\(\)/);
  assert.match(companySettings, /Requerir PIN del empleado/);
  assert.match(scannerContextRoute, /requireEmployeePin: companySettings\.require_employee_pin === true/);
  assert.match(scanner, /if \(context\.requireEmployeePin === false\) void loadPreview/);
  assert.match(scanner, /qrToken && context\.requireEmployeePin && !success && !preview \? <form/);
  assert.match(scanner, /PIN del empleado<input[\s\S]*required/);
});

test("missing PIN schema reports the canonical migration prerequisite", () => {
  assert.match(companyRoute, /function isMissingPinSettingColumn/);
  assert.match(companyRoute, /error\.code === "42703" \|\| error\.code === "PGRST204"/);
  assert.match(companyRoute, /20261107211000_optional_employee_pin_requirement\.sql/);
  assert.match(companyRoute, /if \(error\) return companyLookupError\(error\)/);
});

test("scanner API maps structured PIN rejections to established HTTP statuses", () => {
  assert.match(route, /pin_locked[\s\S]*status: 429[\s\S]*code: "P0001"/);
  assert.match(route, /pin_not_configured[\s\S]*status: 409[\s\S]*code: "23514"/);
  assert.match(route, /pin_invalid[\s\S]*status: 422[\s\S]*code: "22023"/);
  assert.match(route, /pinFailure\(rpcData\.pinError\)/);
  assert.match(route, /Object\.hasOwn\(rpcData, "pinError"\)/);
  assert.match(route, /if \(!pinError\)[\s\S]*status: 503/);
});

test("PIN migration retains SECURITY DEFINER, authenticated scanner grants and private verifier", () => {
  assert.equal((optionalPinMigration.match(/returns jsonb language plpgsql security definer set search_path = ''/g) ?? []).length, 2);
  assert.match(optionalPinMigration, /grant execute on function public\.scan_employee_attendance\(uuid,text,text,text\) to authenticated/);
  assert.match(optionalPinMigration, /grant execute on function public\.confirm_employee_attendance\(uuid,text,text,text,public\.attendance_event_type,uuid,uuid\) to authenticated/);
  assert.doesNotMatch(optionalPinMigration, /grant execute on function private\.verify_employee_pin/);
  assert.match(optionalPinMigration, /revoke all on function public\.scan_employee_attendance\(uuid,text,text,text\) from public, anon/);
  assert.match(migration, /for update/);
});

test("attendance API ignores PIN only when the selected company's setting is off", () => {
  assert.match(route, /select\("require_employee_pin"\)/);
  assert.match(route, /if \(requirePin && \(typeof data\.pin !== "string" \|\| !\/\^\\d\{6,12\}\$\//);
  assert.match(route, /const pin = requirePin \? data\.pin as string : null/);
  assert.equal((route.match(/p_pin: pin/g) ?? []).length, 2);
});

test("QR ciphertext is cleared on revocation without weakening the employee permission check", () => {
  assert.match(revokeCipherMigration, /begin;[\s\S]*update private\.employee_qr_tokens[\s\S]*revoked_at = clock_timestamp\(\), encrypted_token = null[\s\S]*commit;/);
  assert.match(revokeCipherMigration, /private\.has_company_permission\(p_company_id, 'employees\.manage'\)/);
  assert.match(revokeCipherMigration, /role in \('owner', 'admin'\)/);
  assert.match(revokeCipherMigration, /revoke all on function public\.revoke_employee_qr_token\(uuid, uuid\) from public, anon/);
});
