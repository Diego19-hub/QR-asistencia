import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { createScheduleSchema, durationMinutes } from "@/lib/schedules/validation";

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const params = new URL(request.url).searchParams;
  const branchId = params.get("branchId");
  if (branchId && !z.string().uuid().safeParse(branchId).success) return apiError("invalid_branch", "La sucursal seleccionada no es válida.", 400);
  const [{ data: branches, error: branchError }, { data: employees, error: employeeError }, { data: templates, error: templateError }] = await Promise.all([
    scope.supabase.from("branches").select("id,name,timezone,active").eq("company_id", scope.company.companyId).order("name"),
    scope.supabase.from("employees").select("id,employee_number,first_name,last_name,branch_id,active").eq("company_id", scope.company.companyId).eq("active", true).order("last_name").order("first_name"),
    scope.supabase.from("schedule_templates").select("id,company_id,branch_id,name,kind,active,workday_type,entry_tolerance_minutes,effective_from,effective_to,revision_of,created_at").eq("company_id", scope.company.companyId).order("created_at", { ascending: false }),
  ]);
  if (branchError || employeeError || templateError) return apiError("schedule_data_failed", "No fue posible cargar los horarios y el personal.", 503);

  const templateIds = (templates ?? []).map((item) => item.id);
  const { data: days, error: daysError } = templateIds.length
    ? await scope.supabase.from("schedule_template_days").select("id,company_id,template_id,iso_weekday,start_local,end_local,scheduled_minutes").eq("company_id", scope.company.companyId).in("template_id", templateIds).order("iso_weekday")
    : { data: [], error: null };
  if (daysError) return apiError("schedule_days_failed", "No fue posible cargar los días configurados.", 503);
  const dayIds = (days ?? []).map((day) => day.id);
  const { data: breaks, error: breaksError } = dayIds.length
    ? await scope.supabase.from("schedule_template_breaks").select("id,template_day_id,break_rule_id,planned_start_local,planned_end_local,planned_minutes").eq("company_id", scope.company.companyId).in("template_day_id", dayIds)
    : { data: [], error: null };
  if (breaksError) return apiError("schedule_breaks_failed", "No fue posible cargar los descansos configurados.", 503);
  const ruleIds = [...new Set((breaks ?? []).map((item) => item.break_rule_id))];
  const { data: rules, error: rulesError } = ruleIds.length
    ? await scope.supabase.from("break_rules").select("id,code,name,counts_as_work,required,max_minutes,requires_qr,effective_from,effective_to").eq("company_id", scope.company.companyId).in("id", ruleIds)
    : { data: [], error: null };
  if (rulesError) return apiError("break_rules_failed", "No fue posible cargar las reglas de descanso.", 503);

  const rulesById = new Map((rules ?? []).map((rule) => [rule.id, rule]));
  const breaksByDay = new Map<string, typeof breaks>();
  for (const item of breaks ?? []) breaksByDay.set(item.template_day_id, [...(breaksByDay.get(item.template_day_id) ?? []), item]);
  const daysByTemplate = new Map<string, Array<Record<string, unknown>>>();
  for (const day of days ?? []) {
    const dayBreaks = (breaksByDay.get(day.id) ?? []).map((item) => ({ ...item, rule: rulesById.get(item.break_rule_id) ?? null }));
    daysByTemplate.set(day.template_id, [...(daysByTemplate.get(day.template_id) ?? []), { ...day, breaks: dayBreaks }]);
  }
  const query = params.get("search")?.trim().toLocaleLowerCase("es-MX") ?? "";
  let items = (templates ?? []).map((template) => ({ ...template, days: daysByTemplate.get(template.id) ?? [] }));
  if (branchId) items = items.filter((item) => item.branch_id === branchId);
  if (params.has("active")) items = items.filter((item) => item.active === (params.get("active") === "true"));
  if (query) items = items.filter((item) => item.name.toLocaleLowerCase("es-MX").includes(query));
  return Response.json({
    company: { id: scope.company.companyId, name: scope.company.companyName },
    branches: branches ?? [],
    employees: employees ?? [],
    items,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = createScheduleSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Revisa el nombre, las fechas, el turno y los descansos configurados.", fields: parsed.error.flatten().fieldErrors } }, { status: 422, headers: { "Cache-Control": "no-store" } });
  const { scope } = result;
  const branch = await scope.supabase.from("branches").select("id,timezone,active").eq("company_id", scope.company.companyId).eq("id", parsed.data.branchId).maybeSingle();
  if (branch.error) return apiError("branch_lookup_failed", "No fue posible validar la sucursal.", 503);
  if (!branch.data?.active) return apiError("branch_forbidden", "Selecciona una sucursal activa de esta empresa.", 422);

  const days = parsed.data.days.map((day) => ({
    weekday: day.weekday,
    start_local: day.start,
    end_local: day.end,
    scheduled_minutes: durationMinutes(day.start, day.end) - day.breaks.filter((item) => !item.countsAsWork).reduce((sum, item) => sum + durationMinutes(item.start, item.end), 0),
    breaks: day.breaks.map((item) => ({
      name: item.name,
      planned_start_local: item.start,
      planned_end_local: item.end,
      planned_minutes: durationMinutes(item.start, item.end),
      counts_as_work: item.countsAsWork,
      requires_qr: item.requiresQr,
      required: item.required,
      max_minutes: item.maxMinutes,
    })),
  }));
  if (days.some((day) => day.scheduled_minutes < 1)) return apiError("invalid_planned_duration", "Los descansos no pueden cubrir todo el turno.", 422);
  const { data, error } = await scope.supabase.rpc("save_schedule_template", {
    p_company_id: scope.company.companyId,
    p_branch_id: parsed.data.branchId,
    p_name: parsed.data.name,
    p_kind: parsed.data.kind,
    p_workday_type: parsed.data.workdayType,
    p_entry_tolerance_minutes: parsed.data.entryToleranceMinutes,
    p_effective_from: parsed.data.effectiveFrom,
    p_effective_to: parsed.data.effectiveTo,
    p_days: days,
    p_revision_of: parsed.data.revisionOf,
  });
  if (error?.code === "42501") return apiError("schedule_write_forbidden", "Tu rol no puede administrar horarios en esta sucursal.", 403);
  if (error) return apiError("schedule_create_failed", error.code === "23514" || error.code === "22023" ? "Los datos del horario no cumplen las reglas de validación." : "No fue posible guardar el horario.", error.code === "23514" || error.code === "22023" ? 422 : 503);
  return Response.json({ item: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
