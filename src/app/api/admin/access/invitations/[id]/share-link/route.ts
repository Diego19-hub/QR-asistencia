import { checkAdminCompanyPermission, permissionCheckError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { createShareInvitationToken, createShareInvitationUrl, hashShareInvitationToken } from "@/lib/access/share-invitation";
import { getAuthRedirectUrl } from "@/lib/supabase/auth-admin";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { scope } = result;
  const permissionError = permissionCheckError(
    await checkAdminCompanyPermission(scope, "company.manage"),
    "No tienes permiso para generar enlaces de invitación.",
  );
  if (permissionError) return permissionError;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: { code: "invalid_invitation_id", message: "La invitación no es válida." } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const confirmUrl = getAuthRedirectUrl("confirm");
  if (!confirmUrl) return Response.json({ error: { code: "public_origin_unavailable", message: "No se pudo preparar un enlace público seguro." } }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const token = createShareInvitationToken();
  const tokenHash = hashShareInvitationToken(token);
  const { data: expiresAt, error } = await scope.supabase.rpc("set_company_user_invitation_share_link", {
    p_company_id: scope.company.companyId,
    p_invitation_id: id,
    p_token_hash: tokenHash,
  });
  if (error || !expiresAt) {
    const status = error?.code === "42501" ? 403 : error?.code === "P0002" ? 404 : error?.code === "22023" ? 400 : 503;
    const code = status === 403 ? "company_manage_required" : status === 404 ? "invitation_unavailable" : status === 400 ? "invalid_share_token" : "share_link_failed";
    const message = status === 403 ? "No tienes permiso para administrar esta invitación." : status === 404 ? "La invitación no está disponible." : status === 400 ? "No se pudo validar el enlace." : "No fue posible generar el enlace.";
    return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }

  // Keep a regenerated link visible to this authorized admin only, in-memory in the UI.
  const shareUrl = createShareInvitationUrl(new URL(confirmUrl).origin, token);
  return Response.json({ shareUrl, expiresAt }, {
    status: 201,
    headers: { "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" },
  });
}
