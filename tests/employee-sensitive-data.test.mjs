import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createEmployeeSchema, employeeRfcSchema, employeeNssSchema, patchEmployeeSchema } from "../src/lib/employees/validation.ts";

const root = new URL("../", import.meta.url);

test("worker creation requires a name, 11 digit NSS, and accepts only a valid normalized optional personal RFC", () => {
  const valid = {
    employee_number: "QA-001",
    first_name: "Ana",
    last_name: "Prueba",
    nss: "12345678901",
    personal_rfc: "abcd010203xyz",
  };
  const parsed = createEmployeeSchema.parse(valid);
  assert.equal(parsed.nss, "12345678901");
  assert.equal(parsed.personal_rfc, "ABCD010203XYZ");
  assert.equal(createEmployeeSchema.safeParse({ ...valid, nss: undefined }).success, false);
  assert.equal(createEmployeeSchema.safeParse({ ...valid, nss: "1234567890" }).success, false);
  assert.equal(createEmployeeSchema.safeParse({ ...valid, nss: "1234567890a" }).success, false);
  assert.equal(createEmployeeSchema.safeParse({ ...valid, personal_rfc: "BAD" }).success, false);
  assert.equal(createEmployeeSchema.safeParse({ ...valid, first_name: "" }).success, false);
  assert.equal(createEmployeeSchema.safeParse({ ...valid, last_name: "x".repeat(121) }).success, false);
  assert.equal(createEmployeeSchema.safeParse({ ...valid, personal_rfc: "" }).success, true);
  assert.equal(employeeNssSchema.safeParse("12345678901").success, true);
  assert.equal(employeeRfcSchema.parse("abcd010203xyz"), "ABCD010203XYZ");
});

test("legacy status-only edits remain possible while supplied sensitive values are validated", () => {
  assert.deepEqual(patchEmployeeSchema.parse({ active: false }), { active: false });
  assert.equal(patchEmployeeSchema.safeParse({ nss: "123" }).success, false);
  assert.equal(patchEmployeeSchema.safeParse({ personal_rfc: "BAD" }).success, false);
  assert.equal(patchEmployeeSchema.parse({ personal_rfc: "" }).personal_rfc, null);
});

test("company and worker forms expose required fields with responsive layouts and avoid full PII in lists", async () => {
  const [companySettings, companyRegistration, workerList, workerDetail] = await Promise.all([
    readFile(new URL("src/components/admin/company-settings.tsx", root), "utf8"),
    readFile(new URL("src/app/(auth)/crear-empresa/registration-form.tsx", root), "utf8"),
    readFile(new URL("src/components/employees/employee-management.tsx", root), "utf8"),
    readFile(new URL("src/components/employees/employee-detail.tsx", root), "utf8"),
  ]);
  for (const source of [companySettings, companyRegistration]) {
    assert.match(source, /name="address"[^>]*required/);
    assert.match(source, /name="rfc"[^>]*required/);
    assert.match(source, /name="employerRegistrationNumber"[^>]*required/);
  }
  assert.match(companySettings, /sm:grid-cols-2/);
  assert.match(companyRegistration, /w-full/);
  assert.match(workerList, /(?:name="nss"[^>]*required|required[^>]*name="nss")/);
  assert.match(workerList, /name="personal_rfc"/);
  assert.match(workerList, /sm:grid-cols-2/);
  assert.match(workerDetail, /(?:name="nss"[^>]*required|required[^>]*name="nss")/);
  assert.match(workerDetail, /employee\.nss\.slice\(-4\)/);
  assert.match(workerDetail, /employee\.personal_rfc\.slice\(0, 3\)/);
});

test("private data is returned only by the protected detail flow and never selected in employee listings", async () => {
  const [listRoute, detailRoute, dataModule, migration] = await Promise.all([
    readFile(new URL("src/app/api/employees/route.ts", root), "utf8"),
    readFile(new URL("src/app/api/employees/[id]/route.ts", root), "utf8"),
    readFile(new URL("src/lib/employees/data.ts", root), "utf8"),
    readFile(new URL("supabase/migrations/20261109150000_required_company_and_employee_sensitive_data.sql", root), "utf8"),
  ]);
  assert.doesNotMatch(dataModule.match(/EMPLOYEE_COLUMNS\s*=\s*"([^"]+)"/)?.[1] ?? "", /nss|personal_rfc/i);
  const listingHandler = listRoute.slice(0, listRoute.indexOf("export async function POST"));
  assert.doesNotMatch(listingHandler, /get_employee_sensitive_profile|nss|personal_rfc/);
  assert.match(detailRoute, /get_employee_sensitive_profile/);
  assert.match(migration, /revoke all on private\.company_sensitive_data, private\.employee_sensitive_data from public, anon, authenticated/);
  assert.match(migration, /m\.role in \('owner','admin'\)/);
  assert.match(migration, /private\.has_company_permission\(p_company_id,'employees\.read'\)/);
  assert.match(migration, /oldj := oldj - 'rfc'/);
  assert.match(migration, /create unique index company_sensitive_data_rfc_unique/);
  assert.match(migration, /jsonb_build_object\('nss',true,'personal_rfc',rfc_value is not null\)/);
  assert.match(migration, /jsonb_build_object\('nss',true\)/);
});
