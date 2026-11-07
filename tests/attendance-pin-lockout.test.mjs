import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20261107211000_optional_employee_pin_requirement.sql", "utf8");
const route = await readFile("src/app/api/attendance/scan/route.ts", "utf8");
const companyRoute = await readFile("src/app/api/company/route.ts", "utf8");
const scannerContextRoute = await readFile("src/app/api/supervisor/scanner/context/route.ts", "utf8");
const companySettings = await readFile("src/components/admin/company-settings.tsx", "utf8");
const scanner = await readFile("src/components/scanner/mobile-scanner.tsx", "utf8");
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

test("PIN is opt-in for existing companies and both RPCs consult the company setting", () => {
  assert.match(migration, /add column require_employee_pin boolean not null default false/i);
  assert.equal((migration.match(/if require_pin then/g) ?? []).length, 2);
  assert.equal((migration.match(/private\.verify_employee_pin\(p_company_id,emp,p_pin\)/g) ?? []).length, 2);
  assert.equal((migration.match(/select c\.require_employee_pin into require_pin[\s\S]{0,160}if require_pin then/g) ?? []).length, 2);
});

test("attendance API ignores PIN only when the authorized company's setting is off", () => {
  assert.match(route, /select\("require_employee_pin"\)/);
  assert.match(route, /if \(requirePin && \(typeof data\.pin !== "string" \|\| !\/\^\\d\{6,12\}\$\//);
  assert.match(route, /const pin = requirePin \? data\.pin as string : null/);
  assert.equal((route.match(/p_pin: pin/g) ?? []).length, 2);
});

test("company attendance setting is protected by company.manage and exposed in the admin UI", () => {
  assert.match(companyRoute, /requireEmployeePin: z\.boolean\(\)\.optional\(\)/);
  assert.match(companyRoute, /select\("id,name,legal_name,rfc,require_employee_pin,updated_at"\)/);
  assert.match(companyRoute, /checkAdminCompanyPermission\(scope, "company\.manage"\)/);
  assert.match(companyRoute, /changes\.require_employee_pin = parsed\.data\.requireEmployeePin/);
  assert.match(scannerContextRoute, /select\("require_employee_pin"\)/);
  assert.match(scannerContextRoute, /requireEmployeePin: companySettings\.require_employee_pin === true/);
  assert.match(companySettings, /Requerir PIN del empleado/);
  assert.match(companySettings, /disabled=\{!canManage \|\| !companyData \|\| savingAttendanceSetting\}/);
  assert.match(companySettings, /body: JSON\.stringify\(\{ requireEmployeePin \}\)/);
});

test("scanner skips the PIN form and sends no PIN when disabled, preserving required validation otherwise", () => {
  assert.match(scanner, /context\.requireEmployeePin === false\) void loadPreview/);
  assert.match(scanner, /qrToken && context\.requireEmployeePin !== false/);
  assert.match(scanner, /context\.requireEmployeePin === true \? \{ pin \} : \{\}/);
  assert.match(scanner, /minLength=\{6\} maxLength=\{12\}/);
  assert.match(scanner, /className="mt-1\.5 h-12 w-full rounded-xl border border-slate-200 px-4 text-lg tracking-\[\.25em\]" required/);
});
