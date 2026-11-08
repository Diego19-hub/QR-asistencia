import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, migration, shell] = await Promise.all([
  readFile(new URL("../src/app/api/companies/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261107233000_owner_create_additional_company.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/components/admin/admin-shell.tsx", import.meta.url), "utf8"),
]);

test("company creation API derives the actor from Supabase Auth and maps safe validation errors", () => {
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /create_company_for_current_owner/);
  assert.match(route, /p_name: parsed\.data\.name/);
  assert.match(route, /owner_required.*403/s);
  assert.match(route, /validation_failed.*422/s);
  assert.match(route, /Cache-Control.*no-store, private/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test("database creation is owner-only, atomic, audited and does not grant cross-tenant table access", () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /m\.role='owner' and m\.active/);
  assert.match(migration, /create or replace function public\.create_company_for_current_owner/);
  assert.match(migration, /set_config\('qr_asistencia\.create_company_owner'/);
  assert.match(migration, /grant execute on function public\.create_company_for_current_owner\(text,text,text\) to authenticated/);
  assert.match(migration, /revoke all on function public\.create_company_for_current_owner\(text,text,text\) from public,anon/);
  assert.doesNotMatch(migration, /grant (?:insert|all).*public\.companies to authenticated/i);
});

test("only owners see the create action and successful creation refreshes the authorized company context", () => {
  assert.match(shell, /company\.role === "owner" \? <button[^>]*aria-label="Crear otra empresa"/);
  assert.match(shell, /fetch\("\/api\/companies"/);
  assert.match(shell, /setCompanyId\(body\.item\.id\)/);
  assert.match(shell, /router\.refresh\(\)/);
});
