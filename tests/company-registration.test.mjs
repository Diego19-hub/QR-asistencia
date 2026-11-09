import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { companyDetailsSchema, ownerRegistrationSchema } from "../src/lib/access/company-registration.ts";

const root = new URL("../", import.meta.url);

test("owner registration validates and normalizes presentation identity without changing the password", () => {
  const parsed = ownerRegistrationSchema.parse({
    fullName: "  Ana   María Ortega ",
    email: " OWNER@EXAMPLE.INVALID ",
    password: " password with spaces ",
    confirmation: " password with spaces ",
    companyName: "  Empresa QA  ",
    legalName: "  Razón Social QA ",
    rfc: " abc010203xyz ",
  });
  assert.equal(parsed.fullName, "Ana María Ortega");
  assert.equal(parsed.email, "owner@example.invalid");
  assert.equal(parsed.password, " password with spaces ");
  assert.equal(parsed.confirmation, parsed.password);
  assert.equal(parsed.companyName, "Empresa QA");
  assert.equal(parsed.legalName, "Razón Social QA");
  assert.equal(parsed.rfc, "ABC010203XYZ");
});

test("registration rejects invalid names, emails, password mismatch, short passwords and malformed RFC", () => {
  const valid = { fullName: "Ana QA", email: "ana@example.invalid", password: "123456", confirmation: "123456", companyName: "Empresa QA", legalName: "", rfc: "" };
  assert.equal(ownerRegistrationSchema.safeParse({ ...valid, fullName: "A" }).success, false);
  assert.equal(ownerRegistrationSchema.safeParse({ ...valid, email: "invalid" }).success, false);
  assert.equal(ownerRegistrationSchema.safeParse({ ...valid, password: "12345", confirmation: "12345" }).success, false);
  assert.equal(ownerRegistrationSchema.safeParse({ ...valid, confirmation: "654321" }).success, false);
  assert.equal(companyDetailsSchema.safeParse({ companyName: "Empresa QA", legalName: "", rfc: "NO ES RFC" }).success, false);
});

test("login links to first-company registration and no-membership login continues onboarding", async () => {
  const [loginPage, loginAction, registrationPage] = await Promise.all([
    readFile(new URL("src/app/(auth)/login/page.tsx", root), "utf8"),
    readFile(new URL("src/app/(auth)/login/actions.ts", root), "utf8"),
    readFile(new URL("src/app/(auth)/crear-empresa/page.tsx", root), "utf8"),
  ]);
  assert.match(loginPage, /¿No tienes empresa\?\s*<Link href="\/crear-empresa"[^>]*>Crear empresa/);
  assert.match(loginAction, /selected\.kind === "none"\) destination = "\/crear-empresa"/);
  assert.match(registrationPage, /Completar alta de empresa/);
  assert.match(registrationPage, /Crear otra empresa/);
});

test("Auth account creation is separate from company persistence until a session is verified", async () => {
  const actions = await readFile(new URL("src/app/(auth)/crear-empresa/actions.ts", root), "utf8");
  assert.match(actions, /supabase\.auth\.signUp\(\{[\s\S]*?email: parsed\.data\.email,[\s\S]*?password: parsed\.data\.password/);
  assert.match(actions, /data: \{ full_name: parsed\.data\.fullName \}/);
  assert.match(actions, /if \(!data\.session\)[\s\S]*?verification-pending/);
  assert.match(actions, /create_first_company_for_current_user/);
  assert.doesNotMatch(actions, /user_id\s*:\s*parsed|p_user_id|role\s*:\s*["']owner["']/);
  assert.doesNotMatch(actions, /console\.(?:log|warn|error)|JSON\.stringify\(formData/);
});
