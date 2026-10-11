import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { employeeIdSchema } from "@/lib/employees/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const pinSchema = z.object({ pin: z.string().regex(/^\d{6,12}$/, "El PIN debe contener de 6 a 12 dígitos.") }).strict();

function pinError(error: { code?: string }) {
  if (error.code === "42501") return apiError("credential_forbidden", "No tienes permiso para administrar las credenciales de este empleado.", 403);
  if (error.code === "P0002") return apiError("employee_not_found", "No se encontró el empleado en esta empresa.", 404);
  if (error.code === "23514") return apiError("employee_inactive", "Activa el expediente antes de configurar un PIN.", 409);
  if (error.code === "22023") return apiError("invalid_pin", "El PIN debe contener de 6 a 12 dígitos.", 422);
  return apiError("pin_operation_failed", "No fue posible guardar el PIN.", 503);
}

export async function PUT(request: Request, { params }: RouteContext) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!employeeIdSchema.safeParse(id).success) return apiError("invalid_employee_id", "El identificador de empleado no es válido.", 400);

  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = pinSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: { code: "invalid_pin", message: "El PIN debe contener de 6 a 12 dígitos." } }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }

  const { data, error } = await result.scope.supabase.rpc("set_employee_pin", {
    p_company_id: result.scope.company.companyId,
    p_employee_id: id,
    p_pin: parsed.data.pin,
  });
  if (error) return pinError(error);
  return Response.json({ credential: data }, { headers: { "Cache-Control": "no-store, private" } });
}
