import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { dateForRange, dateInTimeZone } from "@/lib/datetime";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idSchema = z.string().uuid();

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const params = new URL(request.url).searchParams;
  const { data: branches, error: branchesError } = await scope.supabase
    .from("branches").select("id,name,timezone,active").eq("company_id", scope.company.companyId).order("name");
  if (branchesError) return apiError("attendance_branches_failed", "No fue posible cargar las sucursales.", 503);

  const todayDates = (branches ?? []).map((branch) => dateInTimeZone(new Date(), branch.timezone));
  const defaultTo = todayDates.sort().at(-1) ?? dateInTimeZone(new Date(), "America/Mexico_City");
  const to = params.get("to") ?? defaultTo;
  const from = params.get("from") ?? dateForRange(new Date(`${to}T12:00:00Z`), -29);
  const branchId = params.get("branchId");
  if (!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success || from > to) {
    return apiError("invalid_attendance_range", "Selecciona un rango de fechas válido.", 400);
  }
  if (branchId && (!idSchema.safeParse(branchId).success || !(branches ?? []).some((branch) => branch.id === branchId && branch.active))) {
    return apiError("attendance_branch_forbidden", "La sucursal no pertenece a esta empresa o está inactiva.", 403);
  }

  let sessionQuery = scope.supabase.from("attendance_sessions")
    .select("id,employee_id,branch_id,local_work_date,timezone,status,started_at,ended_at,scheduled_start_at,scheduled_end_at,assignment_id")
    .eq("company_id", scope.company.companyId).gte("local_work_date", from).lte("local_work_date", to)
    .order("local_work_date", { ascending: false }).order("started_at", { ascending: false }).limit(500);
  if (branchId) sessionQuery = sessionQuery.eq("branch_id", branchId);
  const { data: sessions, error: sessionsError } = await sessionQuery;
  if (sessionsError) return apiError("attendance_sessions_failed", "No fue posible consultar las jornadas.", 503);
  const sessionIds = (sessions ?? []).map((item) => item.id);
  const employeeIds = [...new Set((sessions ?? []).map((item) => item.employee_id))];
  const [{ data: totals, error: totalsError }, { data: employees, error: employeesError }, { data: breaks, error: breaksError }] = await Promise.all([
    sessionIds.length ? scope.supabase.from("attendance_session_totals").select("session_id,employee_id,local_work_date,timezone,scheduled_minutes,presence_minutes,all_break_minutes,non_work_break_minutes,effective_work_minutes,schedule_delta_minutes,lateness_minutes,early_departure_minutes,detected_overtime_minutes").eq("company_id", scope.company.companyId).in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
    employeeIds.length ? scope.supabase.from("employees").select("id,employee_number,first_name,last_name").eq("company_id", scope.company.companyId).in("id", employeeIds) : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? scope.supabase.from("attendance_breaks").select("session_id,is_incomplete").eq("company_id", scope.company.companyId).in("session_id", sessionIds).eq("is_incomplete", true) : Promise.resolve({ data: [], error: null }),
  ]);
  if (totalsError) return apiError("attendance_totals_failed", "No fue posible consultar los cálculos de asistencia.", 503);
  if (employeesError || breaksError) return apiError("attendance_details_failed", "No fue posible cargar el detalle de las jornadas.", 503);

  const sessionById = new Map((sessions ?? []).map((item) => [item.id, item]));
  const employeeById = new Map((employees ?? []).map((item) => [item.id, item]));
  const incompleteSessionIds = new Set((breaks ?? []).map((item) => item.session_id));
  const visibleTotals = totals ?? [];
  const branchById = new Map((branches ?? []).map((branch) => [branch.id, branch]));
  const items = visibleTotals.flatMap((total) => {
    const session = sessionById.get(total.session_id);
    const employee = employeeById.get(total.employee_id);
    if (!session || !employee) return [];
    const branch = branchById.get(session.branch_id);
    const incomplete = incompleteSessionIds.has(total.session_id);
    return [{
      ...total,
      branchId: session.branch_id,
      branchName: branch?.name ?? "Sucursal",
      status: session.status,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      scheduledStartAt: session.scheduled_start_at,
      scheduledEndAt: session.scheduled_end_at,
      assignmentId: session.assignment_id,
      hasIncompleteBreaks: incomplete,
      classification: session.status === "open" ? "open" : incomplete ? "incomplete" : total.scheduled_minutes === null ? "unscheduled" : "closed",
      employee: { id: employee.id, employeeNumber: employee.employee_number, name: `${employee.first_name} ${employee.last_name}` },
      branchTimezone: branch?.timezone ?? total.timezone,
    }];
  });

  return Response.json({ from, to, branches: (branches ?? []).filter((branch) => branch.active), truncated: (sessions ?? []).length === 500, items,
    summary: {
      sessions: items.length,
      open: items.filter((item) => item.classification === "open").length,
      incomplete: items.filter((item) => item.hasIncompleteBreaks).length,
      unscheduled: items.filter((item) => item.classification === "unscheduled").length,
      presenceMinutes: items.reduce((sum, item) => sum + item.presence_minutes, 0),
      effectiveMinutes: items.reduce((sum, item) => sum + item.effective_work_minutes, 0),
    },
  }, { headers: { "Cache-Control": "no-store, private" } });
}
