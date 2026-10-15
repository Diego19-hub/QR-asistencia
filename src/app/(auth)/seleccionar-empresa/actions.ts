"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { destinationForRole, type MembershipRole } from "@/lib/access/user-management";
import { setActiveMembershipCookie } from "@/lib/access/active-membership-cookie";

export async function chooseMembership(formData: FormData) {
  const membershipId = formData.get("membershipId");
  if (typeof membershipId !== "string") redirect("/seleccionar-empresa?error=invalid");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: membership, error } = await supabase.from("company_memberships")
    .select("id,company_id,role").eq("id", membershipId).eq("user_id", auth.user.id).eq("active", true).maybeSingle();
  if (error || !membership) redirect("/seleccionar-empresa?error=invalid");
  await setActiveMembershipCookie(membership.id);
  redirect(destinationForRole(membership.role as MembershipRole));
}
