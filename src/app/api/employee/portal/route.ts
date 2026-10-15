import { z } from "zod";
import { cookies } from "next/headers";

import { activeEmployeeCompanyIds, isOwnActiveEmployee } from "@/lib/employee/portal-scope";
import { createClient } from "@/lib/supabase/server";
import { dateInTimeZone } from "@/lib/datetime";

const querySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) });

function apiError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store, private" } });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return apiError("unauthenticated", "Inicia sesión para consultar tu portal.", 401);
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ page: params.get("page") ?? "1" });
  if (!parsed.success) return apiError("invalid_page", "La página solicitada no es válida.", 400);

  const { data: memberships, error: membershipsError } = await supabase.from("company_memberships")
    .select("id,company_id,role,active").eq("user_id", auth.user.id).eq("active", true);
  if (membershipsError) return apiError("membership_lookup_failed", "No fue posible validar tu membresía.", 503);
  const selectedId = (await cookies()).get("qr_active_membership_id")?.value;
  const selectedMembership = selectedId ? (memberships ?? []).find((membership) => membership.id === selectedId) : null;
  const soleMembership = memberships?.length === 1 ? memberships[0] : null;
  const activeMembership = selectedMembership ?? soleMembership;
  if (!activeMembership && (memberships ?? []).length > 1) return apiError("company_selection_required", "Selecciona una empresa y un rol antes de consultar el portal.", 409);
  if (activeMembership && activeMembership.role !== "employee") return apiError("employee_role_required", "Selecciona una membresía de empleado para abrir este portal.", 403);
  const companyIds = activeMembership ? [activeMembership.company_id] : activeEmployeeCompanyIds(memberships ?? []);
  if (!companyIds.length) return Response.json({ linked: false, items: [], reason: "no_employee_membership" }, { headers: { "Cache-Control": "no-store, private" } });

  const { data: employees, error: employeesError } = await supabase.from("employees")
    .select("id,company_id,branch_id,employee_number,first_name,last_name,active,auth_user_id")
    .eq("auth_user_id", auth.user.id).eq("active", true).in("company_id", companyIds);
  if (employeesError) return apiError("employee_lookup_failed", "No fue posible cargar tu perfil de empleado.", 503);
  const linkedEmployees = (employees ?? []).filter((employee) => isOwnActiveEmployee(
    employee, auth.user.id, new Set(companyIds),
  ));
  if (!linkedEmployees.length) return Response.json({ linked: false, items: [], reason: "employee_profile_unlinked" }, { headers: { "Cache-Control": "no-store, private" } });

  const employeeIds = linkedEmployees.map((item) => item.id);
  const [{ data: companies, error: companiesError }, { data: assignments, error: assignmentsError }, { data: sessions, error: sessionsError, count }] = await Promise.all([
    supabase.from("companies").select("id,name").in("id", companyIds),
    supabase.from("schedule_assignments").select("id,company_id,employee_id,template_id,branch_id,starts_on,ends_on,timezone,kind,planned_start_local,planned_end_local,planned_minutes")
      .in("company_id", companyIds).in("employee_id", employeeIds).order("starts_on", { ascending: false }).limit(200),
    supabase.from("attendance_sessions").select("id,company_id,employee_id,branch_id,local_work_date,timezone,status,started_at,ended_at,scheduled_start_at,scheduled_end_at", { count: "exact" })
      .in("company_id", companyIds).in("employee_id", employeeIds).order("started_at", { ascending: false })
      .range((parsed.data.page - 1) * 20, parsed.data.page * 20 - 1),
  ]);
  if (companiesError || assignmentsError || sessionsError) return apiError("portal_data_failed", "No fue posible cargar toda tu información.", 503);

  const assignmentRows = assignments ?? [];
  const branchIds = [...new Set([
    ...linkedEmployees.flatMap((item) => item.branch_id ? [item.branch_id] : []),
    ...assignmentRows.map((item) => item.branch_id),
  ])];
  const { data: branches, error: branchesError } = branchIds.length
    ? await supabase.from("branches").select("id,company_id,name,timezone,active").in("company_id", companyIds).in("id", branchIds)
    : { data: [], error: null };
  if (branchesError) return apiError("portal_branches_failed", "No fue posible cargar tus sucursales.", 503);
  const templateIds = [...new Set(assignmentRows.flatMap((item) => item.template_id ? [item.template_id] : []))];
  const [{ data: templates, error: templatesError }, { data: totals, error: totalsError }] = await Promise.all([
    templateIds.length ? supabase.from("schedule_templates").select("id,company_id,name,kind,workday_type,entry_tolerance_minutes,effective_from,effective_to")
      .in("company_id", companyIds).in("id", templateIds) : Promise.resolve({ data: [], error: null }),
    (sessions ?? []).length ? supabase.from("attendance_session_totals")
      .select("session_id,company_id,employee_id,local_work_date,presence_minutes,all_break_minutes,non_work_break_minutes,effective_work_minutes,scheduled_minutes,schedule_delta_minutes,lateness_minutes,early_departure_minutes,detected_overtime_minutes,has_incomplete_breaks")
      .in("company_id", companyIds).in("session_id", (sessions ?? []).map((item) => item.id)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (templatesError || totalsError) return apiError("portal_calculation_failed", "No fue posible cargar horarios o cálculos.", 503);

  const templateDayRows = templateIds.length
    ? await supabase.from("schedule_template_days").select("id,company_id,template_id,iso_weekday,start_local,end_local,scheduled_minutes")
      .in("company_id", companyIds).in("template_id", templateIds).order("iso_weekday")
    : { data: [], error: null };
  if (templateDayRows.error) return apiError("portal_schedule_days_failed", "No fue posible cargar el detalle de tu horario.", 503);
  const templateDayIds = (templateDayRows.data ?? []).map((item) => item.id);
  const templateBreakRows = templateDayIds.length
    ? await supabase.from("schedule_template_breaks").select("id,company_id,template_day_id,break_rule_id,planned_start_local,planned_end_local,planned_minutes")
      .in("company_id", companyIds).in("template_day_id", templateDayIds)
    : { data: [], error: null };
  if (templateBreakRows.error) return apiError("portal_schedule_breaks_failed", "No fue posible cargar descansos programados.", 503);
  const breakRuleIds = [...new Set((templateBreakRows.data ?? []).map((item) => item.break_rule_id))];
  const { data: breakRules, error: breakRulesError } = breakRuleIds.length
    ? await supabase.from("break_rules").select("id,company_id,name,counts_as_work,required").in("company_id", companyIds).in("id", breakRuleIds)
    : { data: [], error: null };
  if (breakRulesError) return apiError("portal_break_rules_failed", "No fue posible cargar las reglas de descanso.", 503);

  const sessionIds = (sessions ?? []).map((item) => item.id);
  const [{ data: events, error: eventsError }, { data: attendanceBreaks, error: breaksError }, { data: overtime, error: overtimeError }] = await Promise.all([
    sessionIds.length ? supabase.from("attendance_events").select("id,company_id,session_id,event_type,occurred_at")
      .in("company_id", companyIds).in("session_id", sessionIds).order("occurred_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? supabase.from("attendance_breaks").select("id,company_id,session_id,counts_as_work,started_at,ended_at,is_incomplete")
      .in("company_id", companyIds).in("session_id", sessionIds).order("started_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? supabase.from("overtime_authorizations").select("id,company_id,session_id,minutes,status,reason,requested_at,decided_at")
      .in("company_id", companyIds).in("session_id", sessionIds).order("requested_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (eventsError || breaksError || overtimeError) return apiError("portal_attendance_detail_failed", "No fue posible cargar el detalle de tus asistencias.", 503);

  const credentialStatuses = await Promise.all(linkedEmployees.map(async (employee) => {
    const { data, error } = await supabase.rpc("get_own_employee_credential_status", {
      p_company_id: employee.company_id,
      p_employee_id: employee.id,
    });
    return { employeeId: employee.id, data: error ? null : data };
  }));
  if (credentialStatuses.some((item) => item.data === null)) return apiError("credential_status_failed", "No fue posible consultar el estado de tu credencial.", 503);

  const templateById = new Map((templates ?? []).map((item) => [item.id, item]));
  const ruleById = new Map((breakRules ?? []).map((item) => [item.id, item]));
  const daysByTemplate = new Map<string, Array<Record<string, unknown>>>();
  for (const day of templateDayRows.data ?? []) {
    const breaks = (templateBreakRows.data ?? []).filter((item) => item.template_day_id === day.id).map((item) => ({
      start: item.planned_start_local,
      end: item.planned_end_local,
      minutes: item.planned_minutes,
      ruleName: ruleById.get(item.break_rule_id)?.name ?? "Descanso",
      countsAsWork: ruleById.get(item.break_rule_id)?.counts_as_work ?? false,
      required: ruleById.get(item.break_rule_id)?.required ?? false,
    }));
    daysByTemplate.set(day.template_id, [...(daysByTemplate.get(day.template_id) ?? []), { ...day, breaks }]);
  }
  const assignmentsByEmployee = new Map<string, typeof assignmentRows>();
  for (const assignment of assignmentRows) assignmentsByEmployee.set(assignment.employee_id, [...(assignmentsByEmployee.get(assignment.employee_id) ?? []), assignment]);
  const totalsBySession = new Map((totals ?? []).map((item) => [item.session_id, item]));
  const latestEventBySession = new Map<string, (typeof events)[number]>();
  for (const event of events ?? []) if (!latestEventBySession.has(event.session_id)) latestEventBySession.set(event.session_id, event);
  const credentialByEmployee = new Map(credentialStatuses.map((item) => [item.employeeId, item.data]));
  const companyById = new Map((companies ?? []).map((item) => [item.id, item]));
  const branchById = new Map((branches ?? []).map((item) => [item.id, item]));

  const items = linkedEmployees.map((employee) => {
    const branch = employee.branch_id ? branchById.get(employee.branch_id) ?? null : null;
    const employeeAssignments = assignmentsByEmployee.get(employee.id) ?? [];
    const currentAssignment = employeeAssignments.find((assignment) => {
      const localToday = dateInTimeZone(new Date(), assignment.timezone);
      return assignment.starts_on <= localToday && (!assignment.ends_on || assignment.ends_on >= localToday);
    }) ?? null;
    const template = currentAssignment?.template_id ? templateById.get(currentAssignment.template_id) ?? null : null;
    const employeeSessions = (sessions ?? []).filter((item) => item.employee_id === employee.id);
    const attendanceItems = employeeSessions.map((session) => ({
      ...session,
      latestEvent: latestEventBySession.get(session.id) ?? null,
      totals: totalsBySession.get(session.id) ?? null,
      breaks: (attendanceBreaks ?? []).filter((item) => item.session_id === session.id),
      overtime: (overtime ?? []).filter((item) => item.session_id === session.id),
    }));
    return {
      company: companyById.get(employee.company_id) ?? { id: employee.company_id, name: "Empresa" },
      employee: { id: employee.id, number: employee.employee_number, firstName: employee.first_name, lastName: employee.last_name, active: employee.active },
      branch,
      schedule: currentAssignment ? {
        assignment: currentAssignment,
        template: template ? { ...template, days: daysByTemplate.get(template.id) ?? [] } : null,
      } : null,
      attendance: attendanceItems,
      credential: credentialByEmployee.get(employee.id),
    };
  });

  return Response.json({ linked: true, items, pagination: { page: parsed.data.page, pageSize: 20, total: count ?? 0, pages: Math.ceil((count ?? 0) / 20) } }, {
    headers: { "Cache-Control": "no-store, private", "Vary": "Cookie" },
  });
}
