import assert from "node:assert/strict";
import test from "node:test";

import {
  canManageAssignedRole,
  classifyCompanyPermissionCheck,
  destinationForRole,
  invitationSchema,
  membershipActionSchema,
  selectInitialMembership,
} from "../src/lib/access/user-management.ts";

test("invitation email is normalized and employee linking is optional", () => {
  const parsed = invitationSchema.parse({ email: "  New.User@Example.com ", role: "employee", employeeId: "" });
  assert.equal(parsed.email, "new.user@example.com");
  assert.equal(parsed.employeeId, null);
});

test("only employee invitations accept an employee expediente id", () => {
  const id = "a93815a3-a625-4bb6-8e88-f563819603eb";
  assert.equal(invitationSchema.safeParse({ email: "worker@example.com", role: "employee", employeeId: id }).success, true);
  assert.equal(invitationSchema.safeParse({ email: "worker@example.com", role: "supervisor", employeeId: id }).success, false);
  assert.equal(invitationSchema.safeParse({ email: "bad", role: "employee" }).success, false);
  assert.equal(invitationSchema.safeParse({ email: "x@example.com", role: "owner" }).success, false);
});

test("manager role policy prevents admins from granting or modifying admin access", () => {
  assert.equal(canManageAssignedRole("admin", "employee", "supervisor"), true);
  assert.equal(canManageAssignedRole("admin", "employee", "admin"), false);
  assert.equal(canManageAssignedRole("admin", "admin", "employee"), false);
  assert.equal(canManageAssignedRole("owner", "employee", "admin"), true);
  assert.equal(canManageAssignedRole("admin", "owner", "employee"), false);
  assert.equal(canManageAssignedRole("supervisor", "employee", "employee"), false);
});

test("permission RPC failures are distinct from valid denials", () => {
  assert.deepEqual(classifyCompanyPermissionCheck(true, null), { allowed: true });
  assert.deepEqual(classifyCompanyPermissionCheck(false, null), { allowed: false, reason: "denied" });
  assert.deepEqual(classifyCompanyPermissionCheck(null, { code: "PGRST202" }), { allowed: false, reason: "unavailable" });
});

test("membership actions accept only strict, tenant-scoped operation shapes", () => {
  assert.equal(membershipActionSchema.safeParse({ action: "deactivate", membershipId: "a93815a3-a625-4bb6-8e88-f563819603eb" }).success, true);
  assert.equal(membershipActionSchema.safeParse({ action: "link-employee", membershipId: "a93815a3-a625-4bb6-8e88-f563819603eb", employeeId: "b93815a3-a625-4bb6-8e88-f563819603eb" }).success, true);
  assert.equal(membershipActionSchema.safeParse({ action: "deactivate", membershipId: "not-a-uuid", companyId: "other-tenant" }).success, false);
  assert.equal(membershipActionSchema.safeParse({ action: "change-role", membershipId: "a93815a3-a625-4bb6-8e88-f563819603eb", role: "owner" }).success, false);
});

test("all memberships require explicit selection; no array-first routing", () => {
  const memberships = [
    { companyId: "company-a", role: "admin", membershipId: "membership-a" },
    { companyId: "company-b", role: "supervisor", membershipId: "membership-b" },
  ];
  assert.equal(selectInitialMembership(memberships).kind, "choose");
  assert.equal(selectInitialMembership(memberships, "membership-b").membership.role, "supervisor");
  assert.deepEqual(selectInitialMembership([]), { kind: "none" });
  assert.equal(destinationForRole("owner"), "/admin");
  assert.equal(destinationForRole("admin"), "/admin");
  assert.equal(destinationForRole("supervisor"), "/scanner");
  assert.equal(destinationForRole("employee"), "/mi-qr");
});
