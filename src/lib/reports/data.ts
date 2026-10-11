import { z } from "zod";

import { resolveAdminScope, type AdminScope } from "@/lib/admin/scope";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuidSchema = z.string().uuid();
const MAX_DAYS = 366;
const MAX_ROWS = 5000;

export type ReportFilters = {
  from: string;
  to: string;
  branchId: string | null;
  employeeId: string | null;
  status: "all" | "open" | "closed" | "incomplete";
};

export type ReportRow = {
  sessionId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  branchId: string;
  branchName: string;
  workDate: string;
  timezone: string;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduledMinutes: number | null;
  clockIn: string | null;
  mealStart: string | null;
  mealEnd: string | null;
  clockOut: string | null;
  presenceMinutes: number;
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
  allBreakMinutes: number;
  effectiveMinutes: number;
  latenessMinutes: number | null;
  earlyDepartureMinutes: number | null;
  detectedOvertimeMinutes: number | null;
  approvedOvertimeMinutes: number;
  status: "open" | "closed";
  incomplete: boolean;
  unscheduled: boolean;
  incidents: string[];
};

export type ReportSummary = {
  employees: number; sessions: number; presenceMinutes: number; effectiveMinutes: number;
  paidBreakMinutes: number; unpaidBreakMinutes: number; latenessMinutes: number;
  earlyDepartureMinutes: number; detectedOvertimeMinutes: number; approvedOvertimeMinutes: number;
  incomplete: number; open: number;
};

export type ReportAnalytics = {
  byDay: { date: string; effectiveMinutes: number; scheduledMinutes: number }[];
  byEmployee: { name: string; latenessMinutes: number }[];
  byBranch: { name: string; effectiveMinutes: number; scheduledMinutes: number }[];
};

export type PayPeriodRule = { mode: "calendar_half_month" | "fixed_days"; anchorDate: string; intervalDays: number } | null;

export type ReportResult =
  | { ok: true; scope: AdminScope; filters: ReportFilters; rows: ReportRow[]; totalRows: number; truncated: boolean; branches: { id: string; name: string }[]; employees: { id: string; employeeNumber: string; name: string; branchId: string | null }[]; summary: ReportSummary; analytics: ReportAnalytics; payPeriodRule: PayPeriodRule }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): ReportResult => ({ ok: false, status, code, message });

function isValidDate(value: string) {
  if (!dateSchema.safeParse(value).success) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function inclusiveDays(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export async function loadReport(request: Request): Promise<ReportResult> {
  const scopeResult = await resolveAdminScope(request);
  if (!scopeResult.ok) return scopeResult;
  const scope = scopeResult.scope;
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const branchId = params.get("branchId") || null;
  const employeeId = params.get("employeeId") || null;
  const statusValue = params.get("status") ?? "all";
  if (!isValidDate(from) || !isValidDate(to) || from > to || inclusiveDays(from, to) > MAX_DAYS) {
    return fail(400, "invalid_report_range", "Selecciona un rango válido de hasta 366 días.");
  }
  if (!["all", "open", "closed", "incomplete"].includes(statusValue)) return fail(400, "invalid_report_status", "El estado seleccionado no es válido.");
  if (branchId && !uuidSchema.safeParse(branchId).success) return fail(400, "invalid_report_branch", "La sucursal seleccionada no es válida.");
  if (employeeId && !uuidSchema.safeParse(employeeId).success) return fail(400, "invalid_report_employee", "El empleado seleccionado no es válido.");
  const filters: ReportFilters = { from, to, branchId, employeeId, status: statusValue as ReportFilters["status"] };

  const [{ data: branches, error: branchError }, { data: employees, error: employeeError }, periodRulesResult] = await Promise.all([
    scope.supabase.from("branches").select("id,name,timezone").eq("company_id", scope.company.companyId).order("name"),
    scope.supabase.from("employees").select("id,employee_number,first_name,last_name,branch_id").eq("company_id", scope.company.companyId).order("last_name").order("first_name").limit(1000),
    scope.supabase.from("company_pay_period_rules").select("biweekly_mode,anchor_date,interval_days").eq("company_id", scope.company.companyId).lte("effective_from", to).or(`effective_to.is.null,effective_to.gte.${to}`).order("effective_from", { ascending: false }).limit(1),
  ]);
  if (branchError || employeeError || periodRulesResult.error) return fail(503, "report_options_failed", "No fue posible validar las sucursales, empleados y periodo de nómina.");
  const branchRows = branches ?? [];
  const employeeRows = employees ?? [];
  const periodRuleRow = periodRulesResult.data?.[0];
  const payPeriodRule: PayPeriodRule = periodRuleRow ? { mode: periodRuleRow.biweekly_mode, anchorDate: periodRuleRow.anchor_date, intervalDays: periodRuleRow.interval_days } : null;
  if (branchId && !branchRows.some((item) => item.id === branchId)) return fail(403, "report_branch_forbidden", "La sucursal no pertenece a tu empresa.");
  if (employeeId && !employeeRows.some((item) => item.id === employeeId && (!branchId || item.branch_id === branchId))) return fail(403, "report_employee_forbidden", "El empleado no pertenece al alcance seleccionado.");

  const allTotals: Record<string, unknown>[] = [];
  for (let start = 0; start <= MAX_ROWS; start += 1000) {
    let query = scope.supabase.from("attendance_session_totals")
      .select("company_id,session_id,employee_id,branch_id,local_work_date,timezone,status,started_at,ended_at,scheduled_start_at,scheduled_end_at,scheduled_minutes,presence_minutes,all_break_minutes,non_work_break_minutes,effective_work_minutes,lateness_minutes,early_departure_minutes,detected_overtime_minutes,has_incomplete_breaks")
      .eq("company_id", scope.company.companyId).gte("local_work_date", from).lte("local_work_date", to)
      .order("local_work_date", { ascending: false }).order("started_at", { ascending: false }).range(start, start + 999);
    if (branchId) query = query.eq("branch_id", branchId);
    if (employeeId) query = query.eq("employee_id", employeeId);
    const { data, error } = await query;
    if (error) return fail(503, "report_attendance_failed", "No fue posible cargar las jornadas calculadas.");
    allTotals.push(...(data ?? []) as unknown as Record<string, unknown>[]);
    if (!data || data.length < 1000) break;
  }
  const truncated = allTotals.length > MAX_ROWS;
  const totals = allTotals.slice(0, MAX_ROWS);
  const sessionIds = totals.map((row) => String(row.session_id));
  if (!sessionIds.length) return {
    ok: true, scope, filters, rows: [], totalRows: 0, truncated: false,
    branches: branchRows.map((item) => ({ id: item.id, name: item.name })),
    employees: employeeRows.map((item) => ({ id: item.id, employeeNumber: item.employee_number, name: `${item.first_name} ${item.last_name}`, branchId: item.branch_id })),
    summary: emptySummary(), analytics: { byDay: [], byEmployee: [], byBranch: [] }, payPeriodRule,
  };

  const [breakResult, eventResult, authorizationResult, rulesResult] = await Promise.all([
    fetchBatched(scope, "attendance_breaks", "session_id,is_incomplete,counts_as_work,started_at,ended_at,break_rule_id", sessionIds),
    fetchBatched(scope, "attendance_events", "session_id,event_type,occurred_at", sessionIds),
    fetchBatched(scope, "overtime_authorizations", "session_id,minutes,status", sessionIds),
    scope.supabase.from("break_rules").select("id,name,code").eq("company_id", scope.company.companyId),
  ]);
  if (breakResult.error || eventResult.error || authorizationResult.error || rulesResult.error) return fail(503, "report_details_failed", "No fue posible cargar eventos, descansos o autorizaciones.");
  const breakRows = breakResult.data;
  const eventRows = eventResult.data;
  const authorizationRows = authorizationResult.data;
  const ruleById = new Map((rulesResult.data ?? []).map((item) => [item.id, item]));
  const employeeById = new Map(employeeRows.map((item) => [item.id, item]));
  const branchById = new Map(branchRows.map((item) => [item.id, item]));
  const breaksBySession = groupBy(breakRows, (row) => String(row.session_id));
  const eventsBySession = groupBy(eventRows, (row) => String(row.session_id));
  const authBySession = groupBy(authorizationRows, (row) => String(row.session_id));

  const mapped = totals.flatMap((total) => {
    const emp = employeeById.get(String(total.employee_id));
    const branch = branchById.get(String(total.branch_id));
    if (!emp || !branch) return [];
    const id = String(total.session_id);
    const breaks = breaksBySession.get(id) ?? [];
    const sessionEvents = eventsBySession.get(id) ?? [];
    const sortedEvents = [...sessionEvents].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    const byType = (type: string) => sortedEvents.find((event) => event.event_type === type)?.occurred_at as string | undefined;
    const withRules: (Record<string, unknown> & { rule: { code: string; name: string } | null })[] = breaks.map((item) => ({
      ...item,
      rule: item.break_rule_id ? ruleById.get(String(item.break_rule_id)) as { code: string; name: string } | undefined ?? null : null,
    }));
    const mealBreak = withRules.find((item) => /meal|comida/i.test(`${item.rule?.code ?? ""} ${item.rule?.name ?? ""}`)) ?? withRules[0];
    const incomplete = total.status === "open" || breaks.some((item) => item.is_incomplete || (item.started_at && !item.ended_at));
    const approved = (authBySession.get(id) ?? []).filter((item) => item.status === "approved").reduce((sum, item) => sum + Number(item.minutes), 0);
    const incidents: string[] = [];
    if (incomplete) incidents.push(total.status === "open" ? "Jornada abierta" : "Descanso incompleto");
    if (total.scheduled_minutes === null) incidents.push("Sin horario programado");
    if (Number(total.lateness_minutes ?? 0) > 0) incidents.push("Retardo");
    if (Number(total.early_departure_minutes ?? 0) > 0) incidents.push("Salida anticipada");
    if (total.status === "closed" && Number(total.detected_overtime_minutes ?? 0) > 0) incidents.push("Tiempo excedente detectado");
    const row: ReportRow = {
      sessionId: id, employeeId: emp.id, employeeNumber: emp.employee_number,
      employeeName: `${emp.first_name} ${emp.last_name}`, branchId: branch.id, branchName: branch.name,
      workDate: String(total.local_work_date), timezone: String(total.timezone),
      scheduledStartAt: total.scheduled_start_at as string | null, scheduledEndAt: total.scheduled_end_at as string | null,
      scheduledMinutes: total.scheduled_minutes as number | null,
      clockIn: byType("clock_in") ?? total.started_at as string | null,
      mealStart: (mealBreak?.started_at as string | null | undefined) ?? null, mealEnd: (mealBreak?.ended_at as string | null | undefined) ?? null,
      clockOut: (total.ended_at as string | null) ?? byType("clock_out") ?? null,
      presenceMinutes: Number(total.presence_minutes),
      paidBreakMinutes: Math.max(0, Number(total.all_break_minutes) - Number(total.non_work_break_minutes)),
      unpaidBreakMinutes: Number(total.non_work_break_minutes), allBreakMinutes: Number(total.all_break_minutes),
      effectiveMinutes: Number(total.effective_work_minutes),
      latenessMinutes: total.lateness_minutes as number | null,
      earlyDepartureMinutes: total.early_departure_minutes as number | null,
      detectedOvertimeMinutes: total.status === "open" ? null : total.detected_overtime_minutes as number | null, approvedOvertimeMinutes: approved,
      status: total.status as "open" | "closed", incomplete, unscheduled: total.scheduled_minutes === null, incidents,
    };
    if (filters.status === "open" && row.status !== "open") return [];
    if (filters.status === "closed" && (row.status !== "closed" || incomplete)) return [];
    if (filters.status === "incomplete" && !incomplete) return [];
    return [row];
  });
  const paged = params.get("all") === "true" ? mapped : (() => {
    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(params.get("pageSize") ?? 50) || 50));
    return mapped.slice((page - 1) * pageSize, page * pageSize);
  })();
  const summary: ReportSummary = {
    employees: new Set(mapped.map((item) => item.employeeId)).size, sessions: mapped.length,
    presenceMinutes: sum(mapped, (item) => item.presenceMinutes), effectiveMinutes: sum(mapped, (item) => item.effectiveMinutes),
    paidBreakMinutes: sum(mapped, (item) => item.paidBreakMinutes), unpaidBreakMinutes: sum(mapped, (item) => item.unpaidBreakMinutes),
    latenessMinutes: sum(mapped, (item) => item.latenessMinutes ?? 0), earlyDepartureMinutes: sum(mapped, (item) => item.earlyDepartureMinutes ?? 0),
    detectedOvertimeMinutes: sum(mapped, (item) => item.detectedOvertimeMinutes ?? 0), approvedOvertimeMinutes: sum(mapped, (item) => item.approvedOvertimeMinutes),
    incomplete: mapped.filter((item) => item.incomplete).length, open: mapped.filter((item) => item.status === "open").length,
  };
  const dayMap = new Map<string, { effectiveMinutes: number; scheduledMinutes: number }>();
  const branchMap = new Map<string, { name: string; effectiveMinutes: number; scheduledMinutes: number }>();
  const employeeMap = new Map<string, { name: string; latenessMinutes: number }>();
  for (const item of mapped) {
    const day = dayMap.get(item.workDate) ?? { effectiveMinutes: 0, scheduledMinutes: 0 };
    day.effectiveMinutes += item.effectiveMinutes; day.scheduledMinutes += item.scheduledMinutes ?? 0; dayMap.set(item.workDate, day);
    const branch = branchMap.get(item.branchId) ?? { name: item.branchName, effectiveMinutes: 0, scheduledMinutes: 0 };
    branch.effectiveMinutes += item.effectiveMinutes; branch.scheduledMinutes += item.scheduledMinutes ?? 0; branchMap.set(item.branchId, branch);
    const employee = employeeMap.get(item.employeeId) ?? { name: item.employeeName, latenessMinutes: 0 };
    employee.latenessMinutes += item.latenessMinutes ?? 0; employeeMap.set(item.employeeId, employee);
  }
  return {
    ok: true, scope, filters, rows: paged, totalRows: mapped.length, truncated,
    branches: branchRows.map((item) => ({ id: item.id, name: item.name })),
    employees: employeeRows.map((item) => ({ id: item.id, employeeNumber: item.employee_number, name: `${item.first_name} ${item.last_name}`, branchId: item.branch_id })),
    summary, analytics: {
      byDay: [...dayMap].sort(([a], [b]) => a.localeCompare(b)).map(([date, data]) => ({ date, ...data })),
      byEmployee: [...employeeMap.values()].sort((a, b) => b.latenessMinutes - a.latenessMinutes).slice(0, 12),
      byBranch: [...branchMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    }, payPeriodRule,
  };
}

async function fetchBatched(scope: AdminScope, table: "attendance_breaks" | "attendance_events" | "overtime_authorizations", columns: string, sessionIds: string[]) {
  const result: Record<string, unknown>[] = [];
  for (let start = 0; start < sessionIds.length; start += 250) {
    const { data, error } = await scope.supabase.from(table).select(columns).eq("company_id", scope.company.companyId).in("session_id", sessionIds.slice(start, start + 250));
    if (error) return { data: result, error };
    result.push(...(data ?? []) as unknown as Record<string, unknown>[]);
  }
  return { data: result, error: null };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string) {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    result.set(key, [...(result.get(key) ?? []), item]);
  }
  return result;
}

function sum(items: ReportRow[], value: (item: ReportRow) => number) {
  return items.reduce((total, item) => total + value(item), 0);
}

function emptySummary(): ReportSummary {
  return { employees: 0, sessions: 0, presenceMinutes: 0, effectiveMinutes: 0, paidBreakMinutes: 0, unpaidBreakMinutes: 0, latenessMinutes: 0, earlyDepartureMinutes: 0, detectedOvertimeMinutes: 0, approvedOvertimeMinutes: 0, incomplete: 0, open: 0 };
}

export function reportResponseError(result: Extract<ReportResult, { ok: false }>) {
  return Response.json({ error: { code: result.code, message: result.message } }, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
