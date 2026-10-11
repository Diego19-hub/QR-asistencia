/**
 * Accept the request's own origin or the one exact HTTPS hostname configured
 * for the trusted development tunnel. Never trust arbitrary forwarded headers.
 */
export function isAllowedRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    if (originUrl.origin !== origin) return false;

    const requestUrl = new URL(request.url);
    if (originUrl.origin === requestUrl.origin) return true;

    const tunnelHost = process.env.NEXT_ALLOWED_DEV_ORIGIN?.trim().toLowerCase();
    return Boolean(
      tunnelHost &&
        originUrl.protocol === "https:" &&
        originUrl.host.toLowerCase() === tunnelHost,
    );
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
