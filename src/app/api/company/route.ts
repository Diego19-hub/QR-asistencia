import { z } from "zod";

import { apiError, checkAdminCompanyPermission, permissionCheckError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

const companySchema = z.object({
  name: z.string().trim().min(1).max(180),
  legalName: z.string().trim().max(240).nullable(),
  rfc: z.string().trim().toUpperCase().max(13).nullable(),
}).strict().superRefine((value, context) => {
  if (value.rfc && !/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(value.rfc)) {
    context.addIssue({ code: "custom", path: ["rfc"], message: "Revisa el formato del RFC." });
  }
});

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const { data, error } = await scope.supabase.from("companies")
    .select("id,name,legal_name,rfc,updated_at")
    .eq("id", scope.company.companyId).maybeSingle();
  if (error) return apiError("company_lookup_failed", "No fue posible consultar los datos de la empresa.", 503);
  if (!data) return apiError("company_not_found", "No se encontró la empresa activa.", 404);
  const permission = await checkAdminCompanyPermission(scope, "company.manage");
  if (!permission.allowed && permission.reason === "unavailable") {
    return apiError("company_permission_lookup_failed", "No fue posible validar los permisos de configuración. Verifica que la migración de permisos requerida esté aplicada en este entorno.", 503);
  }
  return Response.json({ item: data, canManage: permission.allowed }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = companySchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Revisa el nombre, razón social y RFC." } }, { status: 422, headers: { "Cache-Control": "no-store" } });

  const permissionError = permissionCheckError(await checkAdminCompanyPermission(scope, "company.manage"), "Tu membresía no tiene el permiso company.manage para modificar esta empresa.");
  if (permissionError) return permissionError;

  const { data, error } = await scope.supabase.from("companies").update({
    name: parsed.data.name,
    legal_name: parsed.data.legalName || null,
    rfc: parsed.data.rfc || null,
    updated_at: new Date().toISOString(),
  }).eq("id", scope.company.companyId).select("id,name,legal_name,rfc,updated_at").maybeSingle();
  if (error?.code === "42501") return apiError("company_manage_required", "Tu membresía no tiene permiso para modificar esta empresa.", 403);
  if (error?.code === "23505") return apiError("company_rfc_conflict", "Ese RFC ya está registrado.", 409);
  if (error) return apiError("company_update_failed", "No fue posible guardar la configuración de la empresa.", 503);
  if (!data) return apiError("company_not_found", "No se encontró la empresa activa.", 404);
  return Response.json({ item: data }, { headers: { "Cache-Control": "no-store" } });
}
