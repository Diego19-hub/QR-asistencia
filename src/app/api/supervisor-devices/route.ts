import { z } from "zod";
import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

const reviewSchema = z.object({ requestId: z.string().uuid(), approve: z.boolean() }).strict();

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const companyId = result.scope.company.companyId;
  const [requests, devices] = await Promise.all([
    result.scope.supabase.rpc("list_supervisor_device_requests", { p_company_id: companyId }),
    result.scope.supabase.rpc("list_authorized_supervisor_devices", { p_company_id: companyId }),
  ]);
  if (requests.error || devices.error) {
    const denied = requests.error?.code === "42501" || devices.error?.code === "42501";
    return apiError(denied ? "devices_manage_required" : "devices_unavailable", denied ? "No tienes permiso para administrar dispositivos." : "No fue posible cargar los dispositivos.", denied ? 403 : 503);
  }
  return Response.json({ requests: requests.data, devices: devices.data }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("invalid_json", "La solicitud no es JSON válido.", 400); }
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return apiError("invalid_request", "La resolución de la solicitud no es válida.", 422);
  const { data, error } = await result.scope.supabase.rpc("review_supervisor_device_request", {
    p_company_id: result.scope.company.companyId,
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
  });
  if (error) return apiError(error.code === "42501" ? "devices_manage_required" : "review_failed", error.code === "42501" ? "No tienes permiso para administrar dispositivos." : "La solicitud ya se revisó o no está disponible.", error.code === "42501" ? 403 : 409);
  return Response.json({ request: data }, { headers: { "Cache-Control": "no-store" } });
}
