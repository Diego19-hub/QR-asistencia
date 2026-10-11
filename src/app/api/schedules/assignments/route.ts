import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { assignmentSchema } from "@/lib/schedules/validation";

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const params = new URL(request.url).searchParams;
  const employeeId = params.get("employeeId");
  if (employeeId && !z.string().uuid().safeParse(employeeId).success) return apiError("invalid_employee", "El empleado seleccionado no es válido.", 400);
  let query = scope.supabase.from("schedule_assignments")
    .select("id,employee_id,template_id,branch_id,starts_on,ends_on,timezone,kind,planned_start_local,planned_end_local,planned_minutes,created_at")
    .eq("company_id", scope.company.companyId).order("starts_on", { ascending: false }).limit(1000);
  if (employeeId) query = query.eq("employee_id", employeeId);
  const { data, error } = await query;
  if (error) return apiError("assignments_lookup_failed", "No fue posible cargar el historial de asignaciones.", 503);
  return Response.json({ items: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = assignmentSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Selecciona el horario, empleados y fechas válidas." } }, { status: 422 });
  const { scope } = result;
  const { data, error } = await scope.supabase.rpc("assign_employee_schedule", {
    p_company_id: scope.company.companyId,
    p_employee_ids: parsed.data.employeeIds,
    p_template_id: parsed.data.templateId,
    p_branch_id: parsed.data.branchId,
    p_starts_on: parsed.data.startsOn,
    p_ends_on: parsed.data.endsOn,
  });
  if (error?.code === "42501") return apiError("assignment_write_forbidden", "Tu rol no puede administrar asignaciones en esta sucursal.", 403);
  if (error?.code === "23P01") return apiError("assignment_overlap", "Existe una asignación futura que se cruza con estas fechas. Revisa el historial antes de continuar.", 409);
  if (error?.code === "23503") return apiError("assignment_reference_invalid", "El horario, la sucursal o uno de los empleados ya no está disponible.", 422);
  if (error?.code === "23514" || error?.code === "22023") return apiError("assignment_invalid", "Las fechas no corresponden a la vigencia del horario.", 422);
  if (error) return apiError("assignment_create_failed", "No fue posible guardar la asignación.", 503);
  return Response.json({ items: data ?? [] }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
