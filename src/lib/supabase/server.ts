import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import { getSupabaseConfig } from "./env";
import { isRememberSessionEnabled, REMEMBER_SESSION_COOKIE, withSessionCookieLifetime } from "./session-cookie-policy";

export async function createClient() {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const { url, publishableKey } = getSupabaseConfig();
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secureCookies = process.env.NODE_ENV === "production" || forwardedProto === "https";
  const rememberSession = isRememberSessionEnabled(cookieStore.get(REMEMBER_SESSION_COOKIE)?.value);

  return createServerClient(url, publishableKey, {
    cookieOptions: { secure: secureCookies, sameSite: "lax", path: "/" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, withSessionCookieLifetime(options, rememberSession));
          });
        } catch {
          // Server Components cannot write cookies. Proxy refreshes the session.
        }
      },
    },
  });
}
