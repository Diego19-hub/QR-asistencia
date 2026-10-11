import { z } from "zod";
import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

const assignmentSchema = z.object({ membershipId: z.string().uuid(), branchId: z.string().uuid(), assigned: z.boolean() }).strict();

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { data, error } = await result.scope.supabase.rpc("list_supervisors_and_branches", { p_company_id: result.scope.company.companyId });
  if (error) return apiError(error.code === "42501" ? "devices_manage_required" : "supervisors_unavailable", error.code === "42501" ? "No tienes permiso para administrar supervisores." : "No fue posible cargar las asignaciones.", error.code === "42501" ? 403 : 503);
  return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("invalid_json", "La solicitud no es JSON válido.", 400); }
  const parsed = assignmentSchema.safeParse(body);
  if (!parsed.success) return apiError("invalid_assignment", "La asignación no es válida.", 422);
  const { data, error } = await result.scope.supabase.rpc("set_supervisor_branch", {
    p_company_id: result.scope.company.companyId,
    p_membership_id: parsed.data.membershipId,
    p_branch_id: parsed.data.branchId,
    p_assigned: parsed.data.assigned,
  });
  if (error) return apiError(error.code === "42501" ? "devices_manage_required" : "assignment_failed", error.code === "42501" ? "No tienes permiso para administrar supervisores." : "No fue posible actualizar la asignación.", error.code === "42501" ? 403 : 409);
  return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
}
