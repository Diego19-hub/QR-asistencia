import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

const idSchema = z.string().uuid();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return apiError("invalid_attendance_id", "La jornada seleccionada no es válida.", 400);

  const { data: session, error: sessionError } = await scope.supabase.from("attendance_sessions")
    .select("id,employee_id,branch_id,local_work_date,timezone,status,started_at,ended_at,scheduled_start_at,scheduled_end_at")
    .eq("company_id", scope.company.companyId).eq("id", id).maybeSingle();
  if (sessionError) return apiError("attendance_detail_failed", "No fue posible cargar el detalle de la jornada.", 503);
  if (!session) return apiError("attendance_not_found", "No se encontró la jornada solicitada.", 404);

  const [totalsResult, employeeResult, branchResult, eventsResult, breaksResult, rulesResult] = await Promise.all([
    scope.supabase.from("attendance_session_totals").select("scheduled_minutes,presence_minutes,all_break_minutes,non_work_break_minutes,effective_work_minutes,schedule_delta_minutes,lateness_minutes,early_departure_minutes,detected_overtime_minutes,has_incomplete_breaks")
      .eq("company_id", scope.company.companyId).eq("session_id", id).maybeSingle(),
    scope.supabase.from("employees").select("id,employee_number,first_name,last_name").eq("company_id", scope.company.companyId).eq("id", session.employee_id).maybeSingle(),
    scope.supabase.from("branches").select("id,name,timezone").eq("company_id", scope.company.companyId).eq("id", session.branch_id).maybeSingle(),
    scope.supabase.from("attendance_events").select("id,event_type,occurred_at,sequence_no").eq("company_id", scope.company.companyId).eq("session_id", id).order("sequence_no", { ascending: true }),
    scope.supabase.from("attendance_breaks").select("id,break_rule_id,started_at,ended_at,counts_as_work,is_incomplete").eq("company_id", scope.company.companyId).eq("session_id", id).order("started_at", { ascending: true }),
    scope.supabase.from("break_rules").select("id,name,code").eq("company_id", scope.company.companyId),
  ]);
  if (totalsResult.error || employeeResult.error || branchResult.error || eventsResult.error || breaksResult.error || rulesResult.error) {
    return apiError("attendance_detail_failed", "No fue posible cargar los movimientos y cálculos de la jornada.", 503);
  }
  if (!totalsResult.data || !employeeResult.data || !branchResult.data) return apiError("attendance_detail_incomplete", "La jornada no tiene información suficiente para mostrar su detalle.", 503);

  const rulesById = new Map((rulesResult.data ?? []).map((rule) => [rule.id, rule]));
  return Response.json({
    session,
    employee: { id: employeeResult.data.id, employeeNumber: employeeResult.data.employee_number, name: `${employeeResult.data.first_name} ${employeeResult.data.last_name}` },
    branch: branchResult.data,
    totals: totalsResult.data,
    events: eventsResult.data ?? [],
    breaks: (breaksResult.data ?? []).map((item) => ({ ...item, rule: item.break_rule_id ? rulesById.get(item.break_rule_id) ?? null : null })),
  }, { headers: { "Cache-Control": "no-store, private" } });
}
