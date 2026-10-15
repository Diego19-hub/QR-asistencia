import { z } from "zod";

import { apiError, checkAdminCompanyPermission, permissionCheckError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { branchSchema } from "@/lib/schedules/validation";

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { data, error } = await result.scope.supabase.from("branches")
    .select("id,name,timezone,active,created_at")
    .eq("company_id", result.scope.company.companyId).order("name");
  if (error) return apiError("branches_lookup_failed", "No fue posible cargar las sucursales.", 503);
  return Response.json({ items: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const permissionError = permissionCheckError(await checkAdminCompanyPermission(result.scope, "company.manage"), "Tu membresía no tiene permiso para administrar sucursales.");
  if (permissionError) return permissionError;
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = branchSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Revisa nombre y zona horaria." } }, { status: 422 });
  try { new Intl.DateTimeFormat("es-MX", { timeZone: parsed.data.timezone }); }
  catch { return apiError("invalid_timezone", "Selecciona una zona horaria IANA válida.", 422); }

  const { scope } = result;
  const { data, error } = await scope.supabase.from("branches").insert({
    company_id: scope.company.companyId,
    name: parsed.data.name,
    timezone: parsed.data.timezone,
  }).select("id,name,timezone,active").single();
  if (error?.code === "23505") return apiError("branch_name_conflict", "Ya existe una sucursal con ese nombre.", 409);
  if (error?.code === "42501") return apiError("branch_write_forbidden", "Tu rol no puede crear sucursales.", 403);
  if (error || !data) return apiError("branch_create_failed", "No fue posible crear la sucursal.", 503);
  return Response.json({ item: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const permissionError = permissionCheckError(await checkAdminCompanyPermission(result.scope, "company.manage"), "Tu membresía no tiene permiso para administrar sucursales.");
  if (permissionError) return permissionError;
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = z.object({ id: z.string().uuid(), active: z.boolean() }).strict().safeParse(payload);
  if (!parsed.success) return apiError("invalid_branch_update", "La actualización no es válida.", 422);
  const { scope } = result;
  const { data, error } = await scope.supabase.from("branches").update({ active: parsed.data.active })
    .eq("company_id", scope.company.companyId).eq("id", parsed.data.id)
    .select("id,name,timezone,active").maybeSingle();
  if (error?.code === "42501") return apiError("branch_write_forbidden", "Tu rol no puede modificar sucursales.", 403);
  if (error) return apiError("branch_update_failed", "No fue posible actualizar la sucursal.", 503);
  if (!data) return apiError("branch_not_found", "No se encontró la sucursal.", 404);
  return Response.json({ item: data }, { headers: { "Cache-Control": "no-store" } });
}
