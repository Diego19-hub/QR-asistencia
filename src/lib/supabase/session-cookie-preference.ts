import "server-only";

import { cookies, headers } from "next/headers";

import { REMEMBER_SESSION_COOKIE, REMEMBER_SESSION_MAX_AGE_SECONDS } from "./session-cookie-policy";

export async function setRememberSessionPreference(remember: boolean) {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  if (!remember) {
    store.delete(REMEMBER_SESSION_COOKIE);
    return;
  }

  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  store.set(REMEMBER_SESSION_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || forwardedProto === "https",
    path: "/",
    maxAge: REMEMBER_SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearRememberSessionPreference() {
  (await cookies()).delete(REMEMBER_SESSION_COOKIE);
}
