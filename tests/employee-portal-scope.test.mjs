import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { activeEmployeeCompanyIds, isOwnActiveEmployee } from "../src/lib/employee/portal-scope.ts";

const memberships = [
  { company_id: "company-a", role: "owner", active: true },
  { company_id: "company-a", role: "admin", active: true },
  { company_id: "company-a", role: "supervisor", active: true },
  { company_id: "company-a", role: "employee", active: true },
  { company_id: "company-b", role: "employee", active: false },
];

test("portal scope includes only active employee-role memberships", () => {
  assert.deepEqual(activeEmployeeCompanyIds(memberships), ["company-a"]);
});

test("owner, admin and supervisor memberships do not qualify as employee portal access", () => {
  assert.deepEqual(activeEmployeeCompanyIds(memberships.slice(0, 3)), []);
});

test("inactive employee membership does not qualify", () => {
  assert.deepEqual(activeEmployeeCompanyIds([memberships[4]]), []);
});

test("only the employee linked by auth_user_id in an active member company is accepted", () => {
  const scope = new Set(activeEmployeeCompanyIds(memberships));
  assert.equal(isOwnActiveEmployee({ company_id: "company-a", auth_user_id: "user-a", active: true }, "user-a", scope), true);
  assert.equal(isOwnActiveEmployee({ company_id: "company-a", auth_user_id: "user-b", active: true }, "user-a", scope), false);
});

test("an employee from another company is rejected even when the row is active", () => {
  const scope = new Set(activeEmployeeCompanyIds(memberships));
  assert.equal(isOwnActiveEmployee({ company_id: "company-b", auth_user_id: "user-a", active: true }, "user-a", scope), false);
});

test("inactive employee profiles are not returned", () => {
  const scope = new Set(activeEmployeeCompanyIds(memberships));
  assert.equal(isOwnActiveEmployee({ company_id: "company-a", auth_user_id: "user-a", active: false }, "user-a", scope), false);
});

test("portal endpoint binds the employee lookup to the verified auth user and accepts no employee id filter", () => {
  const source = readFileSync(new URL("../src/app/api/employee/portal/route.ts", import.meta.url), "utf8");
  assert.match(source, /\.eq\("auth_user_id", auth\.user\.id\)/);
  assert.doesNotMatch(source, /params\.get\(["']employeeId["']\)/);
});

test("portal credential response calls the status RPC and never reads token material", () => {
  const source = readFileSync(new URL("../src/app/api/employee/portal/route.ts", import.meta.url), "utf8");
  assert.match(source, /get_own_employee_credential_status/);
  assert.doesNotMatch(source, /token_hash|qr_token/i);
});
