import { createClient } from "@/lib/supabase/server";
import { destinationForAccessRole, type AccessRole } from "@/lib/access/access-links";
import { hashShareInvitationToken, isShareInvitationToken } from "@/lib/access/share-invitation";
import { setActiveMembershipCookie } from "@/lib/access/active-membership-cookie";
import { getAuthRedirectUrl } from "@/lib/supabase/auth-admin";

export const runtime = "nodejs";

function json(body: object, status: number) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  } });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return json({ error: { code: "unauthenticated", message: "Inicia sesión para aceptar la invitación." } }, 401);
  if (!auth.user.email_confirmed_at) return json({ error: { code: "email_unconfirmed", message: "Confirma el correo de tu cuenta de Asistencia QR antes de continuar." } }, 403);

  const canonicalConfirmUrl = getAuthRedirectUrl("confirm");
  const canonicalOrigin = canonicalConfirmUrl ? new URL(canonicalConfirmUrl).origin : null;
  if (!canonicalOrigin || request.headers.get("origin") !== canonicalOrigin) {
    return json({ error: { code: "origin_forbidden", message: "No fue posible validar el origen de la solicitud." } }, 403);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return json({ error: { code: "invalid_request", message: "La solicitud no es válida." } }, 400);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 2048) return json({ error: { code: "invalid_request", message: "La solicitud no es válida." } }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: { code: "invalid_request", message: "La solicitud no es válida." } }, 400); }
  const token = body && typeof body === "object" && !Array.isArray(body) && "token" in body
    ? (body as { token?: unknown }).token
    : null;
  if (!isShareInvitationToken(token)) return json({ error: { code: "invitation_unavailable", message: "La invitación no está disponible. Verifica que abriste el enlace completo y que siga vigente." } }, 404);

  const { error } = await supabase.rpc("accept_company_user_share_invitation", {
    p_token_hash: hashShareInvitationToken(token),
  });
  if (error) {
    if (error.code === "P0002") return json({ error: { code: "invitation_unavailable", message: "La invitación no está disponible. Verifica que siga vigente y que esté dirigida a tu correo confirmado." } }, 404);
    if (error.code === "42501") return json({ error: { code: "invitation_forbidden", message: "No se pudo aceptar la invitación. Confirma tu correo o contacta al administrador." } }, 403);
    if (error.code === "23505") return json({ error: { code: "membership_exists", message: "Tu cuenta ya tiene acceso a esta empresa." } }, 409);
    return json({ error: { code: "invitation_accept_failed", message: "No fue posible completar la invitación. Inténtalo de nuevo." } }, 503);
  }

  const { data: memberships, error: membershipError } = await supabase.from("company_memberships")
    .select("id,role").eq("user_id", auth.user.id).eq("active", true);
  if (membershipError || !memberships?.length) {
    return json({ accepted: true, next: "/seleccionar-empresa" }, 200);
  }
  if (memberships.length > 1) return json({ accepted: true, next: "/seleccionar-empresa" }, 200);
  await setActiveMembershipCookie(memberships[0].id);
  const next = destinationForAccessRole(memberships[0].role as AccessRole);
  return json({ accepted: true, next }, 200);
}
