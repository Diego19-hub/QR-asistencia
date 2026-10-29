import { createHash, randomBytes } from "node:crypto";

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createShareInvitationToken() {
  return randomBytes(32).toString("base64url");
}

export function isShareInvitationToken(value: unknown): value is string {
  return typeof value === "string" && SHARE_TOKEN_PATTERN.test(value);
}

export function hashShareInvitationToken(token: string) {
  if (!isShareInvitationToken(token)) throw new Error("El token compartido no es válido.");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Keeps the bearer token in a fragment, which browsers do not send to the server. */
export function createShareInvitationUrl(origin: string, token: string) {
  if (!isShareInvitationToken(token)) throw new Error("El token compartido no es válido.");
  const parsed = new URL(origin);
  if (!new Set(["https:", "http:"]).has(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("El origen público configurado no es válido.");
  }
  const url = new URL("/invitacion/compartida", parsed.origin);
  url.hash = `t=${token}`;
  return url.href;
}
