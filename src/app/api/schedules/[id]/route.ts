import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return apiError("invalid_schedule_id", "El identificador de horario no es válido.", 400);

  const { scope } = result;
  const { data, error } = await scope.supabase.rpc("delete_schedule_template", {
    p_company_id: scope.company.companyId,
    p_template_id: id,
  });
  if (error?.code === "42501") return apiError("schedule_delete_forbidden", "Tu rol no puede eliminar horarios de esta empresa.", 403);
  if (error) return apiError("schedule_delete_failed", "No fue posible eliminar el horario.", 503);

  const outcome = data as { status?: string; reason?: string } | null;
  if (outcome?.status === "not_found") return apiError("schedule_not_found", "No se encontró el horario en esta empresa.", 404);
  if (outcome?.status === "blocked") {
    const message = outcome.reason === "revisions"
      ? "Este horario tiene versiones derivadas. Desactívalo para conservar la relación entre versiones."
      : "Este horario tiene asignaciones o jornadas vinculadas. Desactívalo para conservar el historial.";
    return apiError("schedule_delete_blocked", message, 409);
  }
  if (outcome?.status !== "deleted") return apiError("schedule_delete_failed", "No se pudo confirmar la eliminación del horario.", 503);
  return Response.json({ status: "deleted" }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, { params }: Context) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return apiError("invalid_schedule_id", "El identificador de horario no es válido.", 400);
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = z.object({ active: z.boolean() }).strict().safeParse(payload);
  if (!parsed.success) return apiError("invalid_schedule_status", "El estado seleccionado no es válido.", 422);
  const { scope } = result;
  const { data, error } = await scope.supabase.from("schedule_templates").update({ active: parsed.data.active })
    .eq("company_id", scope.company.companyId).eq("id", id).select("id,active").maybeSingle();
  if (error?.code === "42501") return apiError("schedule_write_forbidden", "Tu rol no puede cambiar este horario.", 403);
  if (error) return apiError("schedule_update_failed", "No fue posible cambiar el estado del horario.", 503);
  if (!data) return apiError("schedule_not_found", "No se encontró el horario.", 404);
  return Response.json({ item: data }, { headers: { "Cache-Control": "no-store" } });
}
