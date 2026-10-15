import type { AdminScope } from "@/lib/admin/scope";
import { dateInTimeZone } from "@/lib/datetime";

export const EMPLOYEE_COLUMNS = "id,employee_number,first_name,last_name,email,auth_user_id,branch_id,active,hired_on,terminated_on,created_at,updated_at";
export type EmployeeRow = Record<string, unknown> & { id: string; branch_id: string | null };

export async function employeeDetails(scope: AdminScope, employee: EmployeeRow) {
  const [rows] = await employeeDetailsBatch(scope, [employee]);
  return rows;
}

export async function employeeDetailsBatch(scope: AdminScope, employees: EmployeeRow[]) {
  if (!employees.length) return [];
  const employeeIds = employees.map((employee) => employee.id);
  const branchIds = [...new Set(employees.flatMap((employee) => employee.branch_id ? [employee.branch_id] : []))];
  const [{ data: branches, error: branchesError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    branchIds.length
      ? scope.supabase.from("branches").select("id,name,timezone").eq("company_id", scope.company.companyId).in("id", branchIds)
      : Promise.resolve({ data: [], error: null }),
    scope.supabase
      .from("schedule_assignments")
      .select("id,employee_id,template_id,branch_id,starts_on,ends_on,timezone,kind,planned_start_local,planned_end_local,planned_minutes")
      .eq("company_id", scope.company.companyId)
      .in("employee_id", employeeIds)
      .order("starts_on", { ascending: false }),
  ]);
  if (branchesError || assignmentsError) throw new Error("employee_related_data_failed");

  const templateIds = [...new Set((assignments ?? []).flatMap((assignment) => assignment.template_id ? [assignment.template_id] : []))];
  const { data: templates, error: templatesError } = templateIds.length
    ? await scope.supabase.from("schedule_templates").select("id,name").eq("company_id", scope.company.companyId).in("id", templateIds)
    : { data: [], error: null };
  if (templatesError) throw new Error("employee_schedule_failed");

  const branchesById = new Map((branches ?? []).map((branch) => [branch.id, branch]));
  const templatesById = new Map((templates ?? []).map((template) => [template.id, template.name]));
  const assignmentsByEmployee = new Map<string, typeof assignments>();
  for (const assignment of assignments ?? []) {
    const previous = assignmentsByEmployee.get(assignment.employee_id) ?? [];
    previous.push(assignment);
    assignmentsByEmployee.set(assignment.employee_id, previous);
  }
  const now = new Date();

  return employees.map((employee) => {
    const currentAssignment = (assignmentsByEmployee.get(employee.id) ?? []).find((assignment) => {
      const localToday = dateInTimeZone(now, assignment.timezone);
      return assignment.starts_on <= localToday && (!assignment.ends_on || assignment.ends_on >= localToday);
    });
    return {
      ...employee,
      branch: employee.branch_id ? branchesById.get(employee.branch_id) ?? null : null,
      currentSchedule: currentAssignment
        ? {
            id: currentAssignment.id,
            name: currentAssignment.template_id ? templatesById.get(currentAssignment.template_id) ?? "Horario asignado" : "Horario variable",
            kind: currentAssignment.kind,
            startsOn: currentAssignment.starts_on,
            endsOn: currentAssignment.ends_on,
            startLocal: currentAssignment.planned_start_local,
            endLocal: currentAssignment.planned_end_local,
            plannedMinutes: currentAssignment.planned_minutes,
          }
        : null,
    };
  });
}
