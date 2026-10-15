"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clearActiveMembershipCookie } from "@/lib/access/active-membership-cookie";

export async function signOutEmployee() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) redirect("/mi-qr?error=signout");
  await clearActiveMembershipCookie();
  redirect("/login");
}
