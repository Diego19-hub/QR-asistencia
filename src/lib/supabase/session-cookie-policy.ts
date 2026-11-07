export const REMEMBER_SESSION_COOKIE = "qr_remember_session";
export const REMEMBER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function isRememberSessionEnabled(value: string | undefined) {
  return value === "1";
}

/** Overrides @supabase/ssr's long default cookie lifetime with an explicit choice. */
export function withSessionCookieLifetime<T extends { maxAge?: number }>(options: T, remember: boolean): T {
  const next = { ...options };

  // Preserve deletion cookies emitted by Supabase Auth.
  if (next.maxAge !== 0) {
    if (remember) next.maxAge = REMEMBER_SESSION_MAX_AGE_SECONDS;
    else delete next.maxAge;
  }

  return next;
}
