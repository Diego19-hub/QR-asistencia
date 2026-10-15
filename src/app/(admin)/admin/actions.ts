"use server";

import { createClient } from "@/lib/supabase/server";
import { setActiveMembershipCookie } from "@/lib/access/active-membership-cookie";

export async function setAdminMembership(membershipId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data: membership, error } = await supabase.from("company_memberships")
    .select("id,role").eq("id", membershipId).eq("user_id", auth.user.id).eq("active", true).in("role", ["owner", "admin"]).maybeSingle();
  if (error || !membership) return false;
  await setActiveMembershipCookie(membership.id);
  return true;
}
