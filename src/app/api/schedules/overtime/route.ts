import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { dateInTimeZone, dateForRange } from "@/lib/datetime";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const params = new URL(request.url).searchParams;
  const to = params.get("to") ?? dateInTimeZone(new Date(), "America/Mexico_City");
  const from = params.get("from") ?? dateForRange(new Date(`${to}T12:00:00Z`), -29);
  if (!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success || from > to) return apiError("invalid_overtime_range", "Selecciona un rango de fechas válido.", 400);
  const { data: totals, error: totalsError } = await scope.supabase.from("attendance_session_totals")
    .select("session_id,employee_id,local_work_date,scheduled_minutes,presence_minutes,all_break_minutes,non_work_break_minutes,effective_work_minutes,schedule_delta_minutes,detected_overtime_minutes")
    .eq("company_id", scope.company.companyId).gte("local_work_date", from).lte("local_work_date", to)
    .order("local_work_date", { ascending: false }).limit(1000);
  if (totalsError) return apiError("overtime_totals_lookup_failed", "No fue posible consultar el tiempo excedente registrado.", 503);
  const sessionIds = (totals ?? []).map((item) => item.session_id);
  const employeeIds = [...new Set((totals ?? []).map((item) => item.employee_id))];
  const [{ data: authorizations, error: authError }, { data: assessments, error: assessmentError }, { data: sessions, error: sessionsError }, { data: rules, error: rulesError }, { data: incompleteBreaks, error: breaksError }] = await Promise.all([
    sessionIds.length ? scope.supabase.from("overtime_authorizations").select("id,session_id,minutes,status,reason,requested_at,decided_at").eq("company_id", scope.company.companyId).in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? scope.supabase.from("overtime_assessments").select("id,session_id,detected_minutes,rule_set_id,assessed_at,detail").eq("company_id", scope.company.companyId).in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? scope.supabase.from("attendance_sessions").select("id,branch_id,status,timezone,started_at,ended_at,scheduled_start_at,scheduled_end_at,labor_rule_set_id").eq("company_id", scope.company.companyId).in("id", sessionIds) : Promise.resolve({ data: [], error: null }),
    scope.supabase.from("labor_rule_sets").select("id,name,settings,effective_from,effective_to").eq("company_id", scope.company.companyId).lte("effective_from", to).or(`effective_to.is.null,effective_to.gte.${from}`),
    sessionIds.length ? scope.supabase.from("attendance_breaks").select("session_id").eq("company_id", scope.company.companyId).in("session_id", sessionIds).eq("is_incomplete", true) : Promise.resolve({ data: [], error: null }),
  ]);
  if (authError || assessmentError || sessionsError || rulesError || breaksError) return apiError("overtime_details_failed", "No fue posible cargar el detalle de tiempo extra.", 503);
  const { data: employees, error: employeesError } = employeeIds.length
    ? await scope.supabase.from("employees").select("id,employee_number,first_name,last_name").eq("company_id", scope.company.companyId).in("id", employeeIds)
    : { data: [], error: null };
  if (employeesError) return apiError("overtime_employees_failed", "No fue posible cargar los nombres de empleados.", 503);
  const branchIds = [...new Set((sessions ?? []).map((item) => item.branch_id))];
  const { data: branches, error: branchesError } = branchIds.length
    ? await scope.supabase.from("branches").select("id,name,timezone").eq("company_id", scope.company.companyId).in("id", branchIds)
    : { data: [], error: null };
  if (branchesError) return apiError("overtime_branches_failed", "No fue posible cargar las sucursales de las jornadas.", 503);
  const sessionById = new Map((sessions ?? []).map((item) => [item.id, item]));
  const incompleteSessionIds = new Set((incompleteBreaks ?? []).map((item) => item.session_id));
  const employeeById = new Map((employees ?? []).map((item) => [item.id, item]));
  const branchById = new Map((branches ?? []).map((item) => [item.id, item]));
  const authBySession = new Map<string, typeof authorizations>();
  for (const item of authorizations ?? []) authBySession.set(item.session_id, [...(authBySession.get(item.session_id) ?? []), item]);
  const assessmentBySession = new Map((assessments ?? []).map((item) => [item.session_id, item]));
  const ruleById = new Map((rules ?? []).map((item) => [item.id, item]));
  const items = (totals ?? []).map((total) => {
    const authorizationItems = authBySession.get(total.session_id) ?? [];
    const approvedMinutes = authorizationItems.filter((item) => item.status === "approved").reduce((sum, item) => sum + item.minutes, 0);
    const pendingMinutes = authorizationItems.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.minutes, 0);
    const requestedMinutes = authorizationItems.filter((item) => item.status !== "cancelled").reduce((sum, item) => sum + item.minutes, 0);
    const assessment = assessmentBySession.get(total.session_id);
    const session = sessionById.get(total.session_id);
    const ruleId = session?.labor_rule_set_id ?? assessment?.rule_set_id;
    const rule = ruleId ? ruleById.get(ruleId) : null;
    const employee = employeeById.get(total.employee_id);
    const overtimeSettings = (rule?.settings as Record<string, unknown> | null)?.overtime as Record<string, unknown> | undefined;
    const configuredThreshold = Number(overtimeSettings?.thresholdMinutes ?? 0);
    const threshold = Number.isFinite(configuredThreshold) ? Math.max(0, configuredThreshold) : 0;
    const recordedMinutes = assessment?.detected_minutes ?? total.detected_overtime_minutes ?? 0;
    const detectedMinutes = overtimeSettings?.detectionEnabled === false ? 0 : Math.max(0, recordedMinutes - threshold);
    const recognizedMinutes = Math.min(detectedMinutes, approvedMinutes);
    return {
      ...total,
      status: session?.status ?? "unknown",
      hasIncompleteBreaks: incompleteSessionIds.has(total.session_id),
      timezone: session?.timezone ?? null,
      startedAt: session?.started_at ?? null,
      endedAt: session?.ended_at ?? null,
      scheduledStartAt: session?.scheduled_start_at ?? null,
      scheduledEndAt: session?.scheduled_end_at ?? null,
      branch: session ? branchById.get(session.branch_id) ?? null : null,
      employee: employee ? { id: employee.id, employeeNumber: employee.employee_number, name: `${employee.first_name} ${employee.last_name}` } : null,
      detectedMinutes,
      requestedMinutes,
      approvedMinutes,
      pendingMinutes,
      recognizedMinutes,
      authorizations: authorizationItems,
      ruleName: rule?.name ?? null,
      overtimeSettings: overtimeSettings ?? null,
    };
  });
  return Response.json({ from, to, items, summary: {
    sessions: items.length,
    detectedMinutes: items.reduce((sum, item) => sum + item.detectedMinutes, 0),
    requestedMinutes: items.reduce((sum, item) => sum + item.requestedMinutes, 0),
    approvedMinutes: items.reduce((sum, item) => sum + item.approvedMinutes, 0),
    pendingMinutes: items.reduce((sum, item) => sum + item.pendingMinutes, 0),
  } }, { headers: { "Cache-Control": "no-store" } });
}
