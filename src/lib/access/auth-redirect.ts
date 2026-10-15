import { isIP } from "node:net";

export type AuthRedirectTarget = "confirm" | "callback-invitation" | "invitation" | "login-invite-error" | "login-auth-error" | "login-confirmed";

const targetPaths: Record<AuthRedirectTarget, string> = {
  confirm: "/auth/confirm",
  "callback-invitation": "/auth/callback?next=%2Finvitacion",
  invitation: "/invitacion",
  "login-invite-error": "/login?error=invite",
  "login-auth-error": "/login?error=auth",
  "login-confirmed": "/login?confirmed=1",
};

function publicOrigin(baseUrl: string | undefined, nodeEnv: string | undefined): URL | null {
  if (!baseUrl) return null;
  try {
    const base = new URL(baseUrl);
    const host = base.hostname.toLowerCase();
    const localDev = nodeEnv !== "production" && base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(host);
    const publicDns = base.protocol === "https:" && host.includes(".") && isIP(host) === 0 &&
      !["localhost", "0.0.0.0"].includes(host) &&
      ![".local", ".internal", ".localhost", ".test"].some((suffix) => host.endsWith(suffix)) &&
      !host.endsWith(".supabase.co");
    if ((!localDev && !publicDns) || base.username || base.password || base.search || base.hash || base.pathname !== "/") return null;
    if (base.protocol === "https:" && base.port && base.port !== "443") return null;
    return new URL(base.origin);
  } catch {
    return null;
  }
}

/**
 * Builds an auth return URL from APP_BASE_URL only. The target is a closed enum,
 * so neither the Host header nor user supplied redirect parameters can set it.
 */
export function getAuthRedirectUrl(target: AuthRedirectTarget, baseUrl = process.env.APP_BASE_URL, nodeEnv = process.env.NODE_ENV): URL | null {
  const origin = publicOrigin(baseUrl, nodeEnv);
  const path = targetPaths[target];
  if (!origin || !path) return null;
  return new URL(path, origin);
}

/** Explicit empty fragment prevents browsers inheriting a legacy auth token fragment. */
export function getAuthRedirectLocation(target: AuthRedirectTarget, baseUrl = process.env.APP_BASE_URL, nodeEnv = process.env.NODE_ENV): string | null {
  const url = getAuthRedirectUrl(target, baseUrl, nodeEnv);
  return url ? `${url.href}#` : null;
}

export function getEmailTokenConfirmationUrl(type: "invite" | "magiclink", tokenHash: string, baseUrl = process.env.APP_BASE_URL, nodeEnv = process.env.NODE_ENV): string | null {
  if (!tokenHash || tokenHash.length > 512 || /[\u0000-\u0020]/.test(tokenHash)) return null;
  const url = getAuthRedirectUrl("confirm", baseUrl, nodeEnv);
  if (!url) return null;
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  return url.toString();
}
