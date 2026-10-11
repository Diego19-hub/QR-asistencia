import { createHash, randomBytes } from "node:crypto";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { employeeIdSchema } from "@/lib/employees/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function databaseError(error: { code?: string; message?: string }) {
  if (error.code === "42501") return apiError("credential_forbidden", "No tienes permiso para administrar las credenciales de este empleado.", 403);
  if (error.code === "P0002") return apiError("employee_not_found", "No se encontró el empleado en esta empresa.", 404);
  if (error.code === "23514") return apiError("employee_inactive", "Activa el expediente antes de emitir una credencial.", 409);
  if (error.code === "23505") return apiError("qr_already_active", "El empleado ya tiene un QR activo. Usa Regenerar para sustituirlo.", 409);
  if (error.code === "22023") return apiError("invalid_credential", "El valor de la credencial no cumple el formato requerido.", 422);
  if (error.code === "P0001") return apiError("qr_rate_limited", "Se alcanzó el límite temporal de emisiones. Intenta nuevamente más tarde.", 429);
  return apiError("credential_operation_failed", "No fue posible completar la operación de credenciales.", 503);
}

export async function GET(request: Request, { params }: RouteContext) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!employeeIdSchema.safeParse(id).success) return apiError("invalid_employee_id", "El identificador de empleado no es válido.", 400);

  const { data, error } = await result.scope.supabase.rpc("get_employee_credential_status", {
    p_company_id: result.scope.company.companyId,
    p_employee_id: id,
  });
  if (error) return databaseError(error);
  return Response.json({ credential: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: RouteContext) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!employeeIdSchema.safeParse(id).success) return apiError("invalid_employee_id", "El identificador de empleado no es válido.", 400);

  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const replace = typeof payload === "object" && payload !== null && "replace" in payload && (payload as { replace?: unknown }).replace === true;
  if (typeof payload !== "object" || payload === null || ("replace" in payload && typeof (payload as { replace?: unknown }).replace !== "boolean")) {
    return apiError("invalid_payload", "La solicitud de credencial no es válida.", 400);
  }

  // The token exists only in this request's memory and the one-time response.
  // Only its SHA-256 digest is sent to Postgres and persisted.
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  const { data, error } = await result.scope.supabase.rpc("issue_employee_qr_token", {
    p_company_id: result.scope.company.companyId,
    p_employee_id: id,
    p_token_hash_hex: tokenHash,
    p_replace: replace,
  });
  if (error) return databaseError(error);
  return Response.json({ credential: data, token: rawToken }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!employeeIdSchema.safeParse(id).success) return apiError("invalid_employee_id", "El identificador de empleado no es válido.", 400);

  const { data, error } = await result.scope.supabase.rpc("revoke_employee_qr_token", {
    p_company_id: result.scope.company.companyId,
    p_employee_id: id,
  });
  if (error) return databaseError(error);
  return Response.json({ credential: data }, { headers: { "Cache-Control": "no-store" } });
}
