import { z } from "zod";

import { resolveAdminScope, scopeError, apiError } from "@/lib/admin/scope";
import { dateForRange, dateInTimeZone } from "@/lib/datetime";

const branchIdSchema = z.string().uuid();
const eventLabels: Record<string, string> = {
  clock_in: "Entrada",
  break_start: "Inicio de descanso",
  break_end: "Fin de descanso",
  clock_out: "Salida",
};

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (branchId && !branchIdSchema.safeParse(branchId).success) return apiError("invalid_branch", "La sucursal seleccionada no es válida.", 400);

  const { data: companyBranches, error: branchesError } = await scope.supabase
    .from("branches")
    .select("id,name,timezone,active")
    .eq("company_id", scope.company.companyId)
    .order("name");
  if (branchesError) return apiError("branches_lookup_failed", "No fue posible cargar las sucursales.", 503);
  if (branchId && !companyBranches?.some((branch) => branch.id === branchId && branch.active)) return apiError("branch_forbidden", "La sucursal no pertenece a esta empresa o ya está inactiva.", 403);
  const activeBranches = (companyBranches ?? []).filter((branch) => branch.active);
  const now = new Date();
  const referenceBranch = (branchId
    ? activeBranches.find((branch) => branch.id === branchId)
    : activeBranches[0]);
  const operatingDate = referenceBranch
    ? dateInTimeZone(now, referenceBranch.timezone)
    : dateInTimeZone(now, "UTC");

  const localDates = (companyBranches ?? []).map((branch) => dateInTimeZone(now, branch.timezone));
  const rangeStart = localDates.length ? localDates.map((date) => dateForRange(new Date(`${date}T12:00:00Z`), -1)).sort()[0] : dateForRange(now, -1);
  const rangeEnd = localDates.length ? localDates.map((date) => dateForRange(new Date(`${date}T12:00:00Z`), 1)).sort().at(-1)! : dateForRange(now, 1);
  let employeeCountQuery = scope.supabase.from("employees").select("id", { count: "exact", head: true }).eq("company_id", scope.company.companyId).eq("active", true);
  let openSessionsQuery = scope.supabase.from("attendance_sessions").select("id,employee_id,branch_id,status,local_work_date,timezone,started_at").eq("company_id", scope.company.companyId).eq("status", "open");
  if (branchId) {
    employeeCountQuery = employeeCountQuery.eq("branch_id", branchId);
    openSessionsQuery = openSessionsQuery.eq("branch_id", branchId);
  }

  const [{ count: employeeCount, error: employeeCountError }, { data: openSessions, error: openSessionsError }, { data: daySessions, error: daySessionsError }, { data: recentEvents, error: recentEventsError }] = await Promise.all([
    employeeCountQuery,
    openSessionsQuery,
    scope.supabase.from("attendance_sessions").select("id,employee_id,branch_id,status,local_work_date,timezone,started_at,ended_at").eq("company_id", scope.company.companyId).gte("local_work_date", rangeStart).lte("local_work_date", rangeEnd).order("started_at", { ascending: false }),
    scope.supabase.from("attendance_events").select("id,session_id,event_type,occurred_at,sequence_no").eq("company_id", scope.company.companyId).order("occurred_at", { ascending: false }).limit(20),
  ]);
  if (employeeCountError || openSessionsError || daySessionsError || recentEventsError) return apiError("dashboard_lookup_failed", "No fue posible cargar las estadísticas.", 503);

  const visibleOpenSessions = (openSessions ?? []).filter((session) => !branchId || session.branch_id === branchId);
  const relevantDaySessions = (daySessions ?? []).filter((session) => !branchId || session.branch_id === branchId);
  const todaysSessions = relevantDaySessions.filter((session) => session.local_work_date === dateInTimeZone(now, session.timezone));
  const completedToday = todaysSessions.filter((session) => session.status === "closed").length;

  const openSessionIds = visibleOpenSessions.map((session) => session.id);
  const { data: currentBreaks, error: breaksError } = openSessionIds.length
    ? await scope.supabase.from("attendance_breaks").select("session_id").eq("company_id", scope.company.companyId).in("session_id", openSessionIds).is("ended_at", null)
    : { data: [], error: null };
  if (breaksError) return apiError("breaks_lookup_failed", "No fue posible consultar los descansos activos.", 503);

  const relevantSessionIds = [...new Set(relevantDaySessions.map((session) => session.id))];
  const { data: incompleteBreaks, error: incompleteError } = relevantSessionIds.length
    ? await scope.supabase.from("attendance_breaks").select("session_id").eq("company_id", scope.company.companyId).in("session_id", relevantSessionIds).eq("is_incomplete", true)
    : { data: [], error: null };
  if (incompleteError) return apiError("incidents_lookup_failed", "No fue posible consultar las incidencias.", 503);
  const incidentSessions = new Set((incompleteBreaks ?? []).map((item) => item.session_id));
  for (const session of relevantDaySessions) {
    const localToday = dateInTimeZone(now, session.timezone);
    if (session.status === "open" && session.local_work_date < localToday) incidentSessions.add(session.id);
  }

  const recentSessionIds = [...new Set((recentEvents ?? []).map((event) => event.session_id))];
  const { data: recentSessions, error: recentSessionsError } = recentSessionIds.length
    ? await scope.supabase.from("attendance_sessions").select("id,employee_id,branch_id,status,timezone").eq("company_id", scope.company.companyId).in("id", recentSessionIds)
    : { data: [], error: null };
  if (recentSessionsError) return apiError("recent_movements_lookup_failed", "No fue posible cargar los movimientos recientes.", 503);
  const recentSessionById = new Map((recentSessions ?? []).map((session) => [session.id, session]));
  const visibleEvents = (recentEvents ?? []).filter((event) => {
    const session = recentSessionById.get(event.session_id);
    return session && (!branchId || session.branch_id === branchId);
  }).slice(0, 8);
  const employeeIds = [...new Set(visibleEvents.flatMap((event) => {
    const id = recentSessionById.get(event.session_id)?.employee_id;
    return id ? [id] : [];
  }))];
  const recentBranchIds = [...new Set(visibleEvents.flatMap((event) => {
    const id = recentSessionById.get(event.session_id)?.branch_id;
    return id ? [id] : [];
  }))];
  const [{ data: recentEmployees, error: recentEmployeesError }, { data: recentBranches, error: recentBranchesError }] = await Promise.all([
    employeeIds.length ? scope.supabase.from("employees").select("id,first_name,last_name").eq("company_id", scope.company.companyId).in("id", employeeIds) : Promise.resolve({ data: [], error: null }),
    recentBranchIds.length ? scope.supabase.from("branches").select("id,name,timezone").eq("company_id", scope.company.companyId).in("id", recentBranchIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (recentEmployeesError || recentBranchesError) return apiError("recent_movements_lookup_failed", "No fue posible cargar los movimientos recientes.", 503);

  const employeesById = new Map((recentEmployees ?? []).map((employee) => [employee.id, employee]));
  const branchesById = new Map((recentBranches ?? []).map((branch) => [branch.id, branch]));
  const movements = visibleEvents.map((event) => {
    const session = recentSessionById.get(event.session_id)!;
    const employee = employeesById.get(session.employee_id);
    const branch = branchesById.get(session.branch_id);
    return {
      id: event.id,
      employee: employee ? `${employee.first_name} ${employee.last_name}` : "Empleado",
      branch: branch?.name ?? "Sin sucursal",
      type: eventLabels[event.event_type] ?? event.event_type,
      occurredAt: event.occurred_at,
      timezone: branch?.timezone ?? session.timezone,
      status: session.status,
    };
  });

  return Response.json({
    company: { id: scope.company.companyId, name: scope.company.companyName },
    operatingDate,
    dateReference: referenceBranch?.timezone ?? "UTC",
    branches: activeBranches,
    filters: { branchId },
    stats: {
      activeEmployees: employeeCount ?? 0,
      openShifts: new Set(visibleOpenSessions.map((session) => session.employee_id)).size,
      onBreak: new Set((currentBreaks ?? []).map((item) => item.session_id)).size,
      completedToday,
      incidents: incidentSessions.size,
    },
    movements,
  }, { headers: { "Cache-Control": "no-store" } });
}
