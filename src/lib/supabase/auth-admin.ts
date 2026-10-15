import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** The service-role credential is intentionally only read by Node server code. */
export function createAuthAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || serviceRoleKey.startsWith("sb_publishable_")) return null;
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function getAuthRedirectUrl(path: string) {
  const base = process.env.APP_BASE_URL;
  if (!base) return null;
  try {
    const url = new URL(base);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return new URL(path, url).toString();
  } catch {
    return null;
  }
}
