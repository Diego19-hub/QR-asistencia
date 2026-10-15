import { z } from "zod";

export const managedRoleSchema = z.enum(["admin", "supervisor", "employee"]);
export type ManagedRole = z.infer<typeof managedRoleSchema>;
export type MembershipRole = ManagedRole | "owner";

const optionalEmployeeId = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.string().uuid().nullable(),
);

export const invitationSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: managedRoleSchema,
  employeeId: optionalEmployeeId,
}).strict().superRefine((value, context) => {
  if (value.role !== "employee" && value.employeeId) {
    context.addIssue({ code: "custom", path: ["employeeId"], message: "Solo una invitación de empleado puede vincular un expediente." });
  }
});

export const membershipActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change-role"), membershipId: z.string().uuid(), role: managedRoleSchema }).strict(),
  z.object({ action: z.literal("deactivate"), membershipId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("link-employee"), membershipId: z.string().uuid(), employeeId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("revoke-invitation"), invitationId: z.string().uuid() }).strict(),
]);

export type ActiveMembership = { companyId: string; role: MembershipRole; membershipId?: string };

export type CompanyPermissionCheck =
  | { allowed: true }
  | { allowed: false; reason: "denied" | "unavailable" };

/** Keeps a missing/failed permission RPC distinct from a valid denial. */
export function classifyCompanyPermissionCheck(data: unknown, error: unknown): CompanyPermissionCheck {
  if (error) return { allowed: false, reason: "unavailable" };
  return data === true ? { allowed: true } : { allowed: false, reason: "denied" };
}

export function canManageAssignedRole(actorRole: MembershipRole, currentRole: MembershipRole, nextRole?: MembershipRole) {
  if (actorRole !== "owner" && actorRole !== "admin") return false;
  if (currentRole === "owner") return false;
  if (actorRole !== "owner" && (currentRole === "admin" || nextRole === "admin")) return false;
  return true;
}

export function destinationForRole(role: MembershipRole) {
  if (role === "owner" || role === "admin") return "/admin";
  if (role === "supervisor") return "/scanner";
  return "/mi-qr";
}

/** A choice is required for every multi-company or multi-role identity. */
export function selectInitialMembership(memberships: ActiveMembership[], selectedMembershipId?: string | null) {
  if (!memberships.length) return { kind: "none" as const };
  if (memberships.length === 1) return { kind: "selected" as const, membership: memberships[0] };
  if (selectedMembershipId) {
    const membership = memberships.find((item) => item.membershipId === selectedMembershipId);
    if (membership) return { kind: "selected" as const, membership };
  }
  return { kind: "choose" as const, memberships };
}
