import { apiError, checkAdminCompanyPermission, permissionCheckError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { createAuthAdminClient, getAuthRedirectUrl } from "@/lib/supabase/auth-admin";
import { invitationSchema, membershipActionSchema } from "@/lib/access/user-management";
import { inviteOrNotifyExisting } from "@/lib/access/invitation-delivery";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const permissionError = permissionCheckError(await checkAdminCompanyPermission(result.scope, "company.manage"), "No tienes permiso para administrar accesos de esta empresa.");
  if (permissionError) return permissionError;
  const { data, error } = await result.scope.supabase.rpc("list_company_user_access", {
    p_company_id: result.scope.company.companyId,
  });
  if (error) return apiError(error.code === "42501" ? "company_manage_required" : "access_list_failed", error.code === "42501" ? "No tienes permiso para administrar accesos." : "No fue posible cargar usuarios e invitaciones.", error.code === "42501" ? 403 : 503);
  return Response.json(data ?? {}, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const permissionError = permissionCheckError(await checkAdminCompanyPermission(scope, "company.manage"), "No tienes permiso para invitar usuarios en esta empresa.");
  if (permissionError) return permissionError;
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("invalid_json", "La solicitud no es JSON válido.", 400); }
  const parsed = invitationSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: { code: "invalid_invitation", message: "Revisa el correo, rol y expediente seleccionado." } }, { status: 422, headers: { "Cache-Control": "no-store" } });

  const admin = createAuthAdminClient();
  const redirectTo = getAuthRedirectUrl("confirm");
  if (!admin || !redirectTo) return apiError("auth_invite_not_configured", "Falta configurar el backend de invitaciones y la URL pública segura. No se creó la invitación.", 503);

  const { data: invitationId, error: invitationError } = await scope.supabase.rpc("create_company_user_invitation", {
    p_company_id: scope.company.companyId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_employee_id: parsed.data.employeeId,
  });
  if (invitationError || !invitationId) {
    const status = invitationError?.code === "42501" ? 403 : invitationError?.code === "23505" ? 409 : 422;
    return apiError(invitationError?.code === "42501" ? "role_assignment_forbidden" : "invitation_create_failed", invitationError?.code === "42501" ? "Tu rol no puede asignar ese nivel de acceso." : invitationError?.code === "23505" ? "Ya existe acceso o una invitación pendiente para ese correo." : "No fue posible registrar la invitación.", status);
  }

  const delivery = await inviteOrNotifyExisting(admin, parsed.data.email, redirectTo, scope.company.companyName);
  if (!delivery.sent) {
    const existingAccount = delivery.mode === "existing-account";
    return Response.json({
      invitationId,
      delivery: existingAccount ? "existing-account" : "failed",
      message: existingAccount
        ? "La invitación quedó pendiente. La persona debe iniciar sesión con esta dirección para aceptarla; Supabase Auth no envió un correo nuevo a una cuenta ya existente."
        : "La invitación quedó pendiente, pero Supabase Auth no pudo entregar el correo. Reintenta cuando se corrija la configuración de correo.",
    }, { status: existingAccount ? 202 : 502, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ invitationId, delivery: "sent", deliveryMode: delivery.mode }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("invalid_json", "La solicitud no es JSON válido.", 400); }
  const parsed = membershipActionSchema.safeParse(body);
  if (!parsed.success) return apiError("invalid_access_action", "La operación solicitada no es válida.", 422);
  const permissionError = permissionCheckError(await checkAdminCompanyPermission(scope, "company.manage"), "No tienes permiso para administrar accesos.");
  if (permissionError) return permissionError;

  let resultData: unknown;
  let error: { code?: string } | null = null;
  if (parsed.data.action === "change-role") {
    ({ data: resultData, error } = await scope.supabase.rpc("change_company_membership_role", {
      p_company_id: scope.company.companyId, p_membership_id: parsed.data.membershipId, p_role: parsed.data.role,
    }));
  } else if (parsed.data.action === "deactivate") {
    ({ data: resultData, error } = await scope.supabase.rpc("deactivate_company_membership", {
      p_company_id: scope.company.companyId, p_membership_id: parsed.data.membershipId,
    }));
  } else if (parsed.data.action === "link-employee") {
    ({ data: resultData, error } = await scope.supabase.rpc("link_employee_account", {
      p_company_id: scope.company.companyId, p_membership_id: parsed.data.membershipId, p_employee_id: parsed.data.employeeId,
    }));
  } else {
    ({ data: resultData, error } = await scope.supabase.rpc("revoke_company_user_invitation", {
      p_company_id: scope.company.companyId, p_invitation_id: parsed.data.invitationId,
    }));
  }
  if (error) {
    const forbidden = error.code === "42501";
    return apiError(forbidden ? "role_assignment_forbidden" : "access_update_failed", forbidden ? "Tu rol no puede realizar ese cambio." : "No fue posible actualizar el acceso.", forbidden ? 403 : error.code === "P0002" ? 404 : 409);
  }
  if (resultData === false) return apiError("access_not_found", "No se encontró el acceso pendiente en esta empresa.", 404);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
