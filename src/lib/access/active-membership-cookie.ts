import "server-only";

import { cookies, headers } from "next/headers";

const COOKIE = "qr_active_membership_id";

export async function setActiveMembershipCookie(membershipId: string) {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  store.set(COOKIE, membershipId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || forwardedProto === "https",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearActiveMembershipCookie() {
  (await cookies()).delete(COOKIE);
}
