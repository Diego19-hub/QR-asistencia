"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { type MembershipRole } from "@/lib/access/user-management";
import { setActiveMembershipCookie } from "@/lib/access/active-membership-cookie";
import {
  accessReturnDestination,
  destinationForAccessRole,
  loginPathForAccessDestination,
} from "@/lib/access/access-links";

export async function chooseMembership(formData: FormData) {
  const requestedNext = accessReturnDestination(formData.get("next"));
  const invalidSelection = `/seleccionar-empresa?error=invalid${requestedNext ? `&next=${encodeURIComponent(requestedNext)}` : ""}`;
  const membershipId = formData.get("membershipId");
  if (typeof membershipId !== "string") redirect(invalidSelection);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(loginPathForAccessDestination(requestedNext));
  const { data: membership, error } = await supabase.from("company_memberships")
    .select("id,company_id,role").eq("id", membershipId).eq("user_id", auth.user.id).eq("active", true).maybeSingle();
  if (error || !membership) redirect(invalidSelection);
  await setActiveMembershipCookie(membership.id);
  redirect(destinationForAccessRole(membership.role as MembershipRole, requestedNext));
}
