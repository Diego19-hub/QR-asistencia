import { z } from "zod";

import { apiError, checkAdminCompanyPermission, permissionCheckError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

const companySchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  legalName: z.string().trim().max(240).nullable().optional(),
  address: z.string().trim().min(1).max(500).optional(),
  employerRegistrationNumber: z.string().trim().min(1).max(64).optional(),
  rfc: z.string().trim().toUpperCase().length(12).optional(),
  requireEmployeePin: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (!Object.keys(value).length) {
    context.addIssue({ code: "custom", message: "Incluye al menos un ajuste." });
  }
  const profileFields = ["name", "address", "rfc", "employerRegistrationNumber"];
  if ((profileFields.some((field) => Object.hasOwn(value, field)) || Object.hasOwn(value, "legalName"))
      && !profileFields.every((field) => Object.hasOwn(value, field))) {
    context.addIssue({ code: "custom", message: "Para guardar la empresa, completa nombre, domicilio, RFC y registro patronal." });
  }
  if (value.rfc && !/^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/.test(value.rfc)) {
    context.addIssue({ code: "custom", path: ["rfc"], message: "Revisa el formato del RFC." });
  }
});

function isMissingPinSettingColumn(error: { code?: string; message?: string } | null) {
  return Boolean(
    error
    && /require_employee_pin/i.test(error.message ?? "")
    && (error.code === "42703" || error.code === "PGRST204"),
  );
}

function companyLookupError(error: { code?: string; message?: string } | null) {
  if (isMissingPinSettingColumn(error)) {
    return apiError(
      "company_attendance_settings_migration_required",
      "La base de datos todavía no incluye la configuración de asistencia. Se requiere aplicar 20261109011259_optional_employee_pin_requirement.sql antes de consultar o guardar el requisito de PIN.",
      503,
    );
  }
  return apiError("company_lookup_failed", "No fue posible consultar los datos de la empresa.", 503);
}

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const { data, error } = await scope.supabase.from("companies")
    .select("id,name,legal_name,require_employee_pin,updated_at")
    .eq("id", scope.company.companyId).maybeSingle();
  if (error) return companyLookupError(error);
  if (!data) return apiError("company_not_found", "No se encontró la empresa activa.", 404);
  const permission = await checkAdminCompanyPermission(scope, "company.manage");
  if (!permission.allowed && permission.reason === "unavailable") {
    return apiError("company_permission_lookup_failed", "No fue posible validar los permisos de configuración. Verifica que la migración de permisos requerida esté aplicada en este entorno.", 503);
  }
  let sensitiveProfile = { address: null as string | null, rfc: null as string | null, employer_registration_number: null as string | null };
  if (permission.allowed) {
    const { data: profile, error: profileError } = await scope.supabase.rpc("get_company_sensitive_profile", { p_company_id: scope.company.companyId });
    if (profileError) return apiError("company_sensitive_profile_lookup_failed", "No fue posible consultar los datos de la empresa.", 503);
    const row = Array.isArray(profile) ? profile[0] : profile;
    if (row) sensitiveProfile = row;
  }
  return Response.json({ item: { ...data, ...sensitiveProfile }, canManage: permission.allowed }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function PATCH(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsed = companySchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Completa los datos obligatorios de la empresa y revisa su formato.", fields: parsed.error.flatten().fieldErrors } }, { status: 422, headers: { "Cache-Control": "no-store" } });

  const permissionError = permissionCheckError(await checkAdminCompanyPermission(scope, "company.manage"), "Tu membresía no tiene el permiso company.manage para modificar esta empresa.");
  if (permissionError) return permissionError;

  const profileProvided = ["name", "legalName", "address", "rfc", "employerRegistrationNumber"].some((field) => Object.hasOwn(parsed.data, field));
  const { data, error } = await scope.supabase.rpc("update_company_settings", {
    p_company_id: scope.company.companyId,
    p_profile: profileProvided ? { name: parsed.data.name, legalName: parsed.data.legalName ?? null, address: parsed.data.address, rfc: parsed.data.rfc, employerRegistrationNumber: parsed.data.employerRegistrationNumber } : null,
    p_require_employee_pin: parsed.data.requireEmployeePin ?? null,
  });
  if (error?.code === "42501") return apiError("company_manage_required", "Tu membresía no tiene permiso para modificar esta empresa.", 403);
  if (error?.code === "23505") return apiError("company_rfc_conflict", "Ese RFC ya está registrado.", 409);
  if (error) {
    if (isMissingPinSettingColumn(error)) return companyLookupError(error);
    return apiError("company_update_failed", "No fue posible guardar la configuración de la empresa.", 503);
  }
  const item = Array.isArray(data) ? data[0] : data;
  if (!item) return apiError("company_not_found", "No se encontró la empresa activa.", 404);
  return Response.json({ item }, { headers: { "Cache-Control": "no-store, private" } });
}
