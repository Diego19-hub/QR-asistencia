import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, profileRoute, migration, legalNameMigration, shell] = await Promise.all([
  readFile(new URL("../src/app/api/companies/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/company/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261109150000_required_company_and_employee_sensitive_data.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261109045525_require_company_legal_name.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/components/admin/admin-shell.tsx", import.meta.url), "utf8"),
]);

test("company creation API derives the actor from Supabase Auth and maps safe validation errors", () => {
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /create_company_for_current_owner/);
  assert.match(route, /p_name: parsed\.data\.name/);
  assert.match(route, /legalName: requiredCompanyLegalNameSchema/);
  assert.match(route, /p_legal_name: parsed\.data\.legalName/);
  assert.match(route, /p_address: parsed\.data\.address/);
  assert.match(route, /p_employer_registration_number: parsed\.data\.employerRegistrationNumber/);
  assert.match(route, /owner_required.*403/s);
  assert.match(route, /validation_failed.*422/s);
  assert.match(route, /Cache-Control.*no-store, private/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test("company profile updates require a nonblank legal name whenever the profile is saved", () => {
  assert.match(profileRoute, /legalName: requiredCompanyLegalNameSchema\.optional\(\)/);
  assert.match(profileRoute, /\["name", "legalName", "address", "rfc", "employerRegistrationNumber"\]/);
  assert.match(profileRoute, /legalName: parsed\.data\.legalName/);
  assert.doesNotMatch(profileRoute, /parsed\.data\.legalName \?\? null/);
});

test("database creation is owner-only, atomic, audited and does not grant cross-tenant table access", () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /m\.user_id=actor and m\.active and m\.role='owner'/);
  assert.match(migration, /create or replace function public\.create_company_for_current_owner/);
  assert.match(migration, /set_config\('qr_asistencia\.create_company_owner'/);
  assert.match(migration, /grant execute on function public\.create_company_for_current_owner\(text,text,text,text,text\) to authenticated/);
  assert.match(migration, /revoke all on function public\.create_company_for_current_owner\(text,text,text,text,text\) from public,anon/);
  assert.match(migration, /private\.company_sensitive_data/);
  assert.match(migration, /create unique index company_sensitive_data_rfc_unique/);
  assert.match(migration, /complete company details required/);
  assert.doesNotMatch(migration, /grant (?:insert|all).*public\.companies to authenticated/i);
  assert.match(legalNameMigration, /before insert or update of legal_name on public\.companies/i);
  assert.match(legalNameMigration, /btrim\(new\.legal_name\) = ''/);
  assert.match(legalNameMigration, /company legal name is required/);
});

test("only owners see the create action and successful creation refreshes the authorized company context", () => {
  assert.match(shell, /company\.role === "owner" \? <button[^>]*aria-label="Crear otra empresa"/);
  assert.match(shell, /fetch\("\/api\/companies"/);
  assert.match(shell, /setCompanyId\(body\.item\.id\)/);
  assert.match(shell, /router\.refresh\(\)/);
});
