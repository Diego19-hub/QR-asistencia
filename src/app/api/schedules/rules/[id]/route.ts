import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

const schema = z.object({ effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return apiError("invalid_labor_rule", "El identificador de regla laboral no es válido.", 400);

  const { scope } = result;
  const { data, error } = await scope.supabase.rpc("delete_labor_rule_set", {
    p_company_id: scope.company.companyId,
    p_rule_set_id: id,
  });
  if (error?.code === "42501") return apiError("labor_rules_delete_forbidden", "Tu rol no puede eliminar reglas laborales de esta empresa.", 403);
  if (error) return apiError("labor_rule_delete_failed", "No fue posible eliminar la regla laboral.", 503);

  const outcome = data as { status?: string; reason?: string } | null;
  if (outcome?.status === "not_found") return apiError("labor_rule_not_found", "No se encontró la regla laboral en esta empresa.", 404);
  if (outcome?.status === "blocked") return apiError("labor_rule_delete_blocked", "Esta regla está vinculada a jornadas o cálculos históricos. Finaliza su vigencia para conservar el historial.", 409);
  if (outcome?.status !== "deleted") return apiError("labor_rule_delete_failed", "No se pudo confirmar la eliminación de la regla laboral.", 503);
  return Response.json({ status: "deleted" }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return apiError("invalid_labor_rule", "El identificador de regla laboral no es válido.", 400);
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return apiError("invalid_labor_rule_end", "La fecha final de vigencia no es válida.", 422);
  const { scope } = result;
  const { data, error } = await scope.supabase.from("labor_rule_sets")
    .update({ effective_to: parsed.data.effectiveTo })
    .eq("company_id", scope.company.companyId).eq("id", id)
    .select("id,name,effective_from,effective_to,settings,created_at").maybeSingle();
  if (error?.code === "42501") return apiError("labor_rules_write_forbidden", "Tu rol no puede actualizar reglas laborales.", 403);
  if (error?.code === "23P01") return apiError("labor_rules_overlap", "La fecha se cruza con otra regla laboral vigente.", 409);
  if (error?.code === "23514") return apiError("labor_rule_dates_invalid", "La fecha final debe ser igual o posterior al inicio de vigencia.", 422);
  if (error) return apiError("labor_rule_update_failed", "No fue posible cerrar la vigencia de la regla.", 503);
  if (!data) return apiError("labor_rule_not_found", "No se encontró la regla laboral.", 404);
  return Response.json({ item: data }, { headers: { "Cache-Control": "no-store" } });
}
