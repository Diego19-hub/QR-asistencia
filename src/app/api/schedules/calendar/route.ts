import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const params = new URL(request.url).searchParams;
  const weekStart = params.get("weekStart");
  const branchId = params.get("branchId");
  if (!weekStart || !dateSchema.safeParse(weekStart).success) return apiError("invalid_week", "Selecciona una semana válida.", 400);
  if (new Date(`${weekStart}T00:00:00.000Z`).getUTCDay() !== 1) return apiError("week_must_start_monday", "La semana debe comenzar en lunes.", 400);
  if (branchId && !z.string().uuid().safeParse(branchId).success) return apiError("invalid_branch", "La sucursal seleccionada no es válida.", 400);
  const weekEnd = addDays(weekStart, 6);
  let assignmentQuery = scope.supabase.from("schedule_assignments")
    .select("id,employee_id,template_id,branch_id,starts_on,ends_on,timezone,kind,planned_start_local,planned_end_local,planned_minutes")
    .eq("company_id", scope.company.companyId).lte("starts_on", weekEnd).or(`ends_on.is.null,ends_on.gte.${weekStart}`).order("starts_on");
  if (branchId) assignmentQuery = assignmentQuery.eq("branch_id", branchId);
  const [{ data: employees, error: employeesError }, { data: branches, error: branchesError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    scope.supabase.from("employees").select("id,employee_number,first_name,last_name,branch_id,active").eq("company_id", scope.company.companyId).eq("active", true).order("last_name").order("first_name"),
    scope.supabase.from("branches").select("id,name,timezone,active").eq("company_id", scope.company.companyId).eq("active", true).order("name"),
    assignmentQuery,
  ]);
  if (employeesError || branchesError || assignmentsError) return apiError("calendar_lookup_failed", "No fue posible cargar el calendario semanal.", 503);
  const templateIds = [...new Set((assignments ?? []).flatMap((item) => item.template_id ? [item.template_id] : []))];
  const { data: templates, error: templatesError } = templateIds.length
    ? await scope.supabase.from("schedule_templates").select("id,name,kind,workday_type,entry_tolerance_minutes,effective_from,effective_to,active").eq("company_id", scope.company.companyId).in("id", templateIds)
    : { data: [], error: null };
  if (templatesError) return apiError("calendar_templates_failed", "No fue posible consultar las plantillas del calendario.", 503);
  const { data: templateDays, error: daysError } = templateIds.length
    ? await scope.supabase.from("schedule_template_days").select("id,template_id,iso_weekday,start_local,end_local,scheduled_minutes").eq("company_id", scope.company.companyId).in("template_id", templateIds)
    : { data: [], error: null };
  if (daysError) return apiError("calendar_days_failed", "No fue posible consultar los días del calendario.", 503);
  const templateById = new Map((templates ?? []).map((item) => [item.id, item]));
  const branchById = new Map((branches ?? []).map((item) => [item.id, item]));
  const daysByTemplateAndWeekday = new Map((templateDays ?? []).map((item) => [`${item.template_id}:${item.iso_weekday}`, item]));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const weekday = index + 1;
    const rows = (employees ?? []).map((employee) => {
      const assignment = (assignments ?? []).find((item) => item.employee_id === employee.id && item.starts_on <= date && (!item.ends_on || item.ends_on >= date));
      const template = assignment?.template_id ? templateById.get(assignment.template_id) : null;
      const scheduledDay = assignment?.template_id ? daysByTemplateAndWeekday.get(`${assignment.template_id}:${weekday}`) : null;
      return {
        employee: { id: employee.id, employeeNumber: employee.employee_number, name: `${employee.first_name} ${employee.last_name}`, active: employee.active },
        branch: assignment ? branchById.get(assignment.branch_id) ?? null : employee.branch_id ? branchById.get(employee.branch_id) ?? null : null,
        assignment: assignment ? { id: assignment.id, startsOn: assignment.starts_on, endsOn: assignment.ends_on, timezone: assignment.timezone, templateName: template?.name ?? "Horario variable", kind: assignment.kind, workdayType: template?.workday_type ?? "mixed", toleranceMinutes: template?.entry_tolerance_minutes ?? 0 } : null,
        schedule: scheduledDay ? { start: scheduledDay.start_local, end: scheduledDay.end_local, plannedMinutes: scheduledDay.scheduled_minutes } : null,
        isRestDay: Boolean(assignment && !scheduledDay),
      };
    }).filter((row) => !branchId || row.branch?.id === branchId);
    return { date, weekday, rows };
  });
  return Response.json({ weekStart, weekEnd, days, branches: branches ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
