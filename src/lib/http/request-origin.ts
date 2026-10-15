function canonicalAppOrigin(): string | null {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (!baseUrl) return null;

  try {
    const base = new URL(baseUrl);
    const host = base.hostname.toLowerCase();
    const localDevelopment = process.env.NODE_ENV !== "production" && base.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(host);
    const isIpLiteral = host.includes(":") || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
    const publicHttps = base.protocol === "https:" && host.includes(".") && !isIpLiteral &&
      !["localhost", "0.0.0.0"].includes(host) &&
      ![".local", ".internal", ".localhost", ".test"].some((suffix) => host.endsWith(suffix)) &&
      !host.endsWith(".supabase.co");

    if ((!localDevelopment && !publicHttps) || base.username || base.password || base.search || base.hash || base.pathname !== "/") return null;
    if (base.protocol === "https:" && base.port && base.port !== "443") return null;
    return base.origin;
  } catch {
    return null;
  }
}

function isAllowedDevelopmentOrigin(originUrl: URL): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const configuredHost = process.env.NEXT_ALLOWED_DEV_ORIGIN?.trim();
  if (!configuredHost) return false;

  try {
    const configured = new URL(`https://${configuredHost}`);
    if (configured.host.toLowerCase() !== configuredHost.toLowerCase() || configured.pathname !== "/" ||
      configured.username || configured.password || configured.search || configured.hash) return false;
    return originUrl.protocol === "https:" && originUrl.host.toLowerCase() === configured.host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Accept the canonical public APP_BASE_URL origin in production. In development,
 * also accept same-origin and the one explicitly configured HTTPS dev origin.
 * Never derive a trusted origin from forwarded headers.
 */
export function isAllowedRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    if (originUrl.origin !== origin) return false;

    const appOrigin = canonicalAppOrigin();
    if (appOrigin && originUrl.origin === appOrigin) return true;

    // The request URL may be the container's internal HTTP address behind Dokploy.
    // In production only APP_BASE_URL is trusted; do not fall back to that URL.
    if (process.env.NODE_ENV === "production") return false;

    const requestUrl = new URL(request.url);
    if (originUrl.origin === requestUrl.origin) return true;

    return isAllowedDevelopmentOrigin(originUrl);
  } catch {
    return false;
  }
}

export function isCurrentContextRequest(
  requestId: number,
  latestRequestId: number,
  signal: AbortSignal,
): boolean {
  return !signal.aborted && requestId === latestRequestId;
}
