import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { EMPLOYEE_COLUMNS, employeeDetails, type EmployeeRow } from "@/lib/employees/data";
import { employeeIdSchema, isValidCalendarDate, patchEmployeeSchema } from "@/lib/employees/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!employeeIdSchema.safeParse(id).success) return apiError("invalid_employee_id", "El identificador de empleado no es válido.", 400);
  const { scope } = result;
  const { data: employee, error } = await scope.supabase.from("employees").select(EMPLOYEE_COLUMNS).eq("company_id", scope.company.companyId).eq("id", id).maybeSingle();
  if (error) return apiError("employee_lookup_failed", "No fue posible cargar el expediente.", 503);
  if (!employee) return apiError("employee_not_found", "No se encontró el empleado.", 404);
  try {
    return Response.json({ item: await employeeDetails(scope, employee as unknown as EmployeeRow) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("employee_related_data_failed", "No fue posible cargar los datos relacionados del empleado.", 503);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!employeeIdSchema.safeParse(id).success) return apiError("invalid_employee_id", "El identificador de empleado no es válido.", 400);
  const { scope } = result;

  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = patchEmployeeSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Revisa los campos indicados.", fields: parsed.error.flatten().fieldErrors } }, { status: 422, headers: { "Cache-Control": "no-store" } });
  if (!isValidCalendarDate(parsed.data.hired_on)) return apiError("invalid_hire_date", "La fecha de ingreso no existe en el calendario.", 422);

  const { data: current, error: currentError } = await scope.supabase.from("employees").select("id,employee_number,branch_id").eq("company_id", scope.company.companyId).eq("id", id).maybeSingle();
  if (currentError) return apiError("employee_lookup_failed", "No fue posible validar el expediente.", 503);
  if (!current) return apiError("employee_not_found", "No se encontró el empleado.", 404);

  if (parsed.data.branch_id) {
    const { data: branch, error } = await scope.supabase.from("branches").select("id").eq("company_id", scope.company.companyId).eq("id", parsed.data.branch_id).eq("active", true).maybeSingle();
    if (error) return apiError("branch_lookup_failed", "No fue posible validar la sucursal.", 503);
    if (!branch) return apiError("branch_forbidden", "Selecciona una sucursal activa de esta empresa.", 422);
  }
  if (parsed.data.employee_number && parsed.data.employee_number !== current.employee_number) {
    const { data: duplicate, error } = await scope.supabase.from("employees").select("id").eq("company_id", scope.company.companyId).eq("employee_number", parsed.data.employee_number).neq("id", id).maybeSingle();
    if (error) return apiError("duplicate_check_failed", "No fue posible validar el identificador.", 503);
    if (duplicate) return apiError("employee_number_conflict", "Ese identificador ya está registrado en la empresa.", 409);
  }

  const { data: updated, error } = await scope.supabase.from("employees").update(parsed.data).eq("company_id", scope.company.companyId).eq("id", id).select(EMPLOYEE_COLUMNS).maybeSingle();
  if (error?.code === "23505") return apiError("employee_number_conflict", "Ese identificador ya está registrado en la empresa.", 409);
  if (error?.code === "42501") return apiError("employee_write_forbidden", "Las políticas de seguridad no permiten actualizar este empleado.", 403);
  if (error) return apiError("employee_update_failed", "No fue posible guardar los cambios.", 503);
  if (!updated) return apiError("employee_write_forbidden", "Las políticas de seguridad no permiten actualizar este empleado.", 403);

  try {
    return Response.json({ item: await employeeDetails(scope, updated as unknown as EmployeeRow) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("employee_updated_details_failed", "Los cambios se guardaron, pero no fue posible cargar los datos relacionados.", 503);
  }
}
