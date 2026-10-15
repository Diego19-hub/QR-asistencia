import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthRedirectUrl, getEmailTokenConfirmationUrl } from "@/lib/access/auth-redirect";

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/**
 * New identities use Supabase Auth's invite and configured Auth SMTP. Existing
 * identities get a one-time Auth magic link via the configured mail delivery
 * provider. Only Auth's hashed token is used, and it is consumed by the SSR
 * confirm route; access/refresh tokens never enter a redirect URL or a log.
 */
export async function inviteOrNotifyExisting(
  admin: SupabaseClient,
  email: string,
  redirectTo: string,
  companyName: string,
) {
  const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!invited.error) return { sent: true as const, mode: "auth-invite" as const };
  if (!/already|registered|exists|duplicate/i.test(invited.error.message)) {
    return { sent: false as const, mode: "failed" as const };
  }

  const mailerKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITATION_FROM_EMAIL;
  if (!mailerKey || !from) return { sent: false as const, mode: "existing-account" as const };

  const generated = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
  const tokenHash = generated.data.properties?.hashed_token;
  if (generated.error || !tokenHash) return { sent: false as const, mode: "failed" as const };
  const confirmationLink = getEmailTokenConfirmationUrl("magiclink", tokenHash);
  const canonicalConfirmUrl = getAuthRedirectUrl("confirm")?.toString();
  if (!confirmationLink || !canonicalConfirmUrl || redirectTo !== canonicalConfirmUrl) return { sent: false as const, mode: "failed" as const };
  const safeCompany = escapeHtml(companyName);
  const safeLink = escapeHtml(confirmationLink);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${mailerKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `Invitación para acceder a ${companyName}`,
        text: `Te invitaron a ${companyName} en Asistencia QR. Abre este enlace seguro para iniciar sesión y aceptar: ${confirmationLink}`,
        html: `<p>Te invitaron a <strong>${safeCompany}</strong> en Asistencia QR.</p><p><a href="${safeLink}">Iniciar sesión y aceptar la invitación</a></p><p>Si no esperabas este mensaje, puedes ignorarlo.</p>`,
      }),
    });
    if (!response.ok) return { sent: false as const, mode: "failed" as const };
    return { sent: true as const, mode: "magic-link" as const };
  } catch {
    return { sent: false as const, mode: "failed" as const };
  }
}
