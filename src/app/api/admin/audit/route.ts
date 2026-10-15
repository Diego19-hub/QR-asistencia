import { z } from "zod";

import { apiError, checkAdminCompanyPermission, permissionCheckError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const actionSchema = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
const safeFieldNames: Record<string, string> = {
  name: "Nombre",
  legal_name: "Razón social",
  rfc: "RFC",
  active: "Estado",
  timezone: "Zona horaria",
  branch_id: "Sucursal",
  starts_on: "Inicio de vigencia",
  ends_on: "Fin de vigencia",
  effective_from: "Inicio de vigencia",
  effective_to: "Fin de vigencia",
  role: "Rol",
  employee_number: "Identificador de empleado",
  workday_type: "Tipo de jornada",
  entry_tolerance_minutes: "Tolerancia de entrada",
  kind: "Tipo",
};

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const permissionError = permissionCheckError(await checkAdminCompanyPermission(scope, "company.manage"), "Tu membresía no tiene permiso para consultar la auditoría administrativa.");
  if (permissionError) return permissionError;

  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const pageSize = Math.max(10, Math.min(50, Number.parseInt(params.get("pageSize") ?? "20", 10) || 20));
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const action = params.get("action") ?? "";
  if ((from && !dateSchema.safeParse(from).success) || (to && !dateSchema.safeParse(to).success) || (from && to && from > to)) {
    return apiError("invalid_audit_date_range", "Selecciona un rango de fechas válido.", 400);
  }
  if (action && !actionSchema.safeParse(action).success) return apiError("invalid_audit_action", "El filtro de acción no es válido.", 400);

  let query = scope.supabase.from("audit_log")
    .select("id,actor_user_id,action,entity_table,entity_id,occurred_at,before_data,after_data", { count: "exact" })
    .eq("company_id", scope.company.companyId)
    .order("occurred_at", { ascending: false }).order("id", { ascending: false });
  if (from) query = query.gte("occurred_at", `${from}T00:00:00.000Z`);
  if (to) {
    const exclusiveEnd = new Date(`${to}T00:00:00.000Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    query = query.lt("occurred_at", exclusiveEnd.toISOString());
  }
  if (action) query = query.eq("action", action);
  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error?.code === "42501") return apiError("company_manage_required", "No tienes permiso para consultar la auditoría.", 403);
  if (error) return apiError("audit_lookup_failed", "No fue posible cargar el historial administrativo.", 503);
  const items = (data ?? []).map(({ before_data, after_data, ...entry }) => {
    const before = before_data && typeof before_data === "object" ? before_data as Record<string, unknown> : {};
    const after = after_data && typeof after_data === "object" ? after_data as Record<string, unknown> : {};
    const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    return { ...entry, changedFields: changedKeys.map((key) => safeFieldNames[key]).filter((label): label is string => Boolean(label)) };
  });
  return Response.json({ items, pagination: { page, pageSize, total: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) } }, { headers: { "Cache-Control": "no-store" } });
}
