import { z } from "zod";

import { apiError, checkAdminCompanyPermission, permissionCheckError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { createAuthAdminClient, getAuthRedirectUrl } from "@/lib/supabase/auth-admin";
import { inviteOrNotifyExisting } from "@/lib/access/invitation-delivery";

const invitationIdSchema = z.string().uuid();

export async function resendCompanyInvitation(request: Request, invitationId: string) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  if (!invitationIdSchema.safeParse(invitationId).success) return apiError("invalid_invitation_id", "La invitación no es válida.", 400);
  const permissionError = permissionCheckError(await checkAdminCompanyPermission(scope, "company.manage"), "No tienes permiso para reenviar invitaciones.");
  if (permissionError) return permissionError;
  const admin = createAuthAdminClient();
  const redirectTo = getAuthRedirectUrl("/auth/callback?next=%2Finvitacion");
  if (!admin || !redirectTo) return apiError("auth_invite_not_configured", "Falta configurar el backend de invitaciones y la URL pública segura.", 503);
  const { data, error } = await scope.supabase.rpc("get_company_user_invitation_for_delivery", {
    p_company_id: scope.company.companyId, p_invitation_id: invitationId,
  });
  if (error) return apiError(error.code === "42501" ? "role_assignment_forbidden" : "invitation_unavailable", "No se puede reenviar esta invitación.", error.code === "42501" ? 403 : 404);
  const invitation = Array.isArray(data) ? data[0] : null;
  if (!invitation?.email) return apiError("invitation_unavailable", "No se puede reenviar esta invitación.", 404);
  const delivery = await inviteOrNotifyExisting(admin, invitation.email, redirectTo, scope.company.companyName);
  if (!delivery.sent) {
    const needsMailer = delivery.mode === "existing-account";
    return apiError(needsMailer ? "existing_account_delivery_unconfigured" : "invite_delivery_failed", needsMailer
      ? "La cuenta ya existe. Configura RESEND_API_KEY e INVITATION_FROM_EMAIL para enviar un enlace seguro, o pide a la persona que inicie sesión para aceptar."
      : "Supabase Auth no pudo entregar el correo. Revisa SMTP y vuelve a intentarlo.", needsMailer ? 503 : 502);
  }
  return Response.json({ ok: true, deliveryMode: delivery.mode }, { headers: { "Cache-Control": "no-store" } });
}
