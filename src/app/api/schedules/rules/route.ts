import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { laborRuleSchema } from "@/lib/schedules/validation";

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { data, error } = await result.scope.supabase.from("labor_rule_sets")
    .select("id,name,effective_from,effective_to,settings,created_at")
    .eq("company_id", result.scope.company.companyId).order("effective_from", { ascending: false });
  if (error) return apiError("labor_rules_lookup_failed", "No fue posible cargar las reglas laborales.", 503);
  return Response.json({ items: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = laborRuleSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Revisa el nombre, la vigencia y los valores configurables." } }, { status: 422 });
  const rule = parsed.data;
  const settings = {
    shiftClassifications: { dayStartsAt: rule.dayStartsAt, nightStartsAt: rule.nightStartsAt },
    restWeekdays: rule.restWeekdays,
    lateGraceMinutes: rule.lateGraceMinutes,
    earlyDepartureGraceMinutes: rule.earlyDepartureGraceMinutes,
    overtime: {
      detectionEnabled: rule.overtimeDetection,
      thresholdMinutes: rule.overtimeThresholdMinutes,
      recognitionPolicy: rule.overtimeRecognition,
    },
  };
  const { data, error } = await result.scope.supabase.from("labor_rule_sets").insert({
    company_id: result.scope.company.companyId,
    name: rule.name,
    effective_from: rule.effectiveFrom,
    effective_to: rule.effectiveTo,
    settings,
  }).select("id,name,effective_from,effective_to,settings,created_at").single();
  if (error?.code === "42501") return apiError("labor_rules_write_forbidden", "Tu rol no puede administrar reglas laborales.", 403);
  if (error?.code === "23P01") return apiError("labor_rules_overlap", "La vigencia se cruza con otra regla laboral de la empresa.", 409);
  if (error?.code === "23514") return apiError("labor_rules_invalid", "La regla no cumple las restricciones de la base de datos.", 422);
  if (error) return apiError("labor_rules_create_failed", "No fue posible guardar las reglas laborales.", 503);
  return Response.json({ item: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
