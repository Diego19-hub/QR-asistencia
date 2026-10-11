import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { EMPLOYEE_COLUMNS, employeeDetails, employeeDetailsBatch, type EmployeeRow } from "@/lib/employees/data";
import { createEmployeeSchema, isValidCalendarDate } from "@/lib/employees/validation";

const searchSchema = z.string().trim().max(80).regex(/^[\p{L}\p{N} ._/-]*$/u);
const branchIdSchema = z.string().uuid();

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(params.get("pageSize") ?? "20", 10) || 20));
  const searchValue = params.get("search")?.trim() ?? "";
  const search = searchSchema.safeParse(searchValue);
  if (!search.success) return apiError("invalid_search", "La búsqueda contiene caracteres no permitidos o es demasiado larga.", 400);

  const activeParam = params.get("active") ?? "all";
  if (!new Set(["all", "true", "false"]).has(activeParam)) {
    return apiError("invalid_active_filter", "Selecciona un estado válido.", 400);
  }
  const branchId = params.get("branchId");
  if (branchId && !branchIdSchema.safeParse(branchId).success) {
    return apiError("invalid_branch", "La sucursal seleccionada no es válida.", 400);
  }
  if (branchId) {
    const { data: branch, error } = await scope.supabase.from("branches").select("id").eq("company_id", scope.company.companyId).eq("id", branchId).maybeSingle();
    if (error) return apiError("branch_lookup_failed", "No fue posible validar la sucursal.", 503);
    if (!branch) return apiError("branch_forbidden", "La sucursal no pertenece a esta empresa.", 403);
  }

  let query = scope.supabase.from("employees").select(EMPLOYEE_COLUMNS, { count: "exact" }).eq("company_id", scope.company.companyId);
  if (activeParam !== "all") query = query.eq("active", activeParam === "true");
  if (branchId) query = query.eq("branch_id", branchId);
  if (search.data) {
    const term = search.data.replaceAll("\\", "").replaceAll("%", "").replaceAll("_", "\\_");
    query = query.or(`employee_number.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
  }
  const from = (page - 1) * pageSize;
  const { data: employees, error, count } = await query
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .range(from, from + pageSize - 1);
  if (error) return apiError("employees_lookup_failed", "No fue posible cargar los empleados.", 503);

  try {
    const [{ data: branches, error: branchesError }, items] = await Promise.all([
      scope.supabase
      .from("branches")
      .select("id,name,timezone")
      .eq("company_id", scope.company.companyId)
      .eq("active", true)
      .order("name"),
      employeeDetailsBatch(scope, (employees ?? []) as unknown as EmployeeRow[]),
    ]);
    if (branchesError) return apiError("branches_lookup_failed", "No fue posible cargar las sucursales.", 503);
    return Response.json({
      company: { id: scope.company.companyId, name: scope.company.companyName },
      items,
      branches: branches ?? [],
      pagination: { page, pageSize, total: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("employee_related_data_failed", "No fue posible cargar los horarios o sucursales asignados.", 503);
  }
}

export async function POST(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = createEmployeeSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Revisa los campos indicados.", fields: parsed.error.flatten().fieldErrors } }, { status: 422, headers: { "Cache-Control": "no-store" } });
  if (!isValidCalendarDate(parsed.data.hired_on)) return apiError("invalid_hire_date", "La fecha de ingreso no existe en el calendario.", 422);

  if (parsed.data.branch_id) {
    const { data: branch, error } = await scope.supabase.from("branches").select("id").eq("company_id", scope.company.companyId).eq("id", parsed.data.branch_id).eq("active", true).maybeSingle();
    if (error) return apiError("branch_lookup_failed", "No fue posible validar la sucursal.", 503);
    if (!branch) return apiError("branch_forbidden", "Selecciona una sucursal activa de esta empresa.", 422);
  }

  const { data: existing, error: duplicateError } = await scope.supabase.from("employees").select("id").eq("company_id", scope.company.companyId).eq("employee_number", parsed.data.employee_number).maybeSingle();
  if (duplicateError) return apiError("duplicate_check_failed", "No fue posible validar el identificador.", 503);
  if (existing) return apiError("employee_number_conflict", "Ese identificador ya está registrado en la empresa.", 409);

  const { data: employee, error } = await scope.supabase.from("employees").insert({
    company_id: scope.company.companyId,
    employee_number: parsed.data.employee_number,
    first_name: parsed.data.first_name,
    last_name: parsed.data.last_name,
    email: parsed.data.email ?? null,
    branch_id: parsed.data.branch_id ?? null,
    hired_on: parsed.data.hired_on ?? null,
  }).select(EMPLOYEE_COLUMNS).single();
  if (error?.code === "23505") return apiError("employee_number_conflict", "Ese identificador ya está registrado en la empresa.", 409);
  if (error?.code === "42501") return apiError("employee_write_forbidden", "Las políticas de seguridad no permiten crear empleados en esta sucursal.", 403);
  if (error || !employee) return apiError("employee_create_failed", "No fue posible registrar el empleado.", 503);

  try {
    return Response.json({ item: await employeeDetails(scope, employee as unknown as EmployeeRow) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("employee_created_details_failed", "El empleado se guardó, pero no fue posible cargar sus datos relacionados.", 503);
  }
}
