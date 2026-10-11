import { z } from "zod";
import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

type Context = { params: Promise<{ id: string }> };
export async function DELETE(request: Request, context: Context) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return apiError("invalid_device", "El identificador de dispositivo no es válido.", 400);
  const { data, error } = await result.scope.supabase.rpc("revoke_supervisor_device", { p_company_id: result.scope.company.companyId, p_device_id: id });
  if (error) return apiError(error.code === "42501" ? "devices_manage_required" : "device_revoke_failed", error.code === "42501" ? "No tienes permiso para administrar dispositivos." : "No se pudo revocar el dispositivo.", error.code === "42501" ? 403 : 409);
  return Response.json({ device: data }, { headers: { "Cache-Control": "no-store" } });
}
