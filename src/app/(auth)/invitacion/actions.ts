"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { destinationForRole, type MembershipRole } from "@/lib/access/user-management";
import { setActiveMembershipCookie } from "@/lib/access/active-membership-cookie";

export async function acceptInvitation(formData: FormData) {
  const invitationId = formData.get("invitationId");
  if (typeof invitationId !== "string") redirect("/invitacion?error=invalid");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { error } = await supabase.rpc("accept_company_user_invitation", { p_invitation_id: invitationId });
  if (error) redirect(`/invitacion?error=${error.code === "42501" ? "forbidden" : "expired"}`);
  const { data: remaining, error: pendingError } = await supabase.rpc("list_my_pending_company_invitations");
  if (pendingError) redirect("/login?error=service");
  if (Array.isArray(remaining) && remaining.length > 0) redirect("/invitacion?accepted=1");
  const { data: memberships, error: membershipError } = await supabase.from("company_memberships")
    .select("id,company_id,role").eq("user_id", auth.user.id).eq("active", true);
  if (membershipError || !memberships?.length) redirect("/login?error=no-company");
  if (memberships.length > 1) redirect("/seleccionar-empresa");
  const membership = memberships[0];
  await setActiveMembershipCookie(membership.id);
  redirect(destinationForRole(membership.role as MembershipRole));
}

export async function setInvitationPassword(formData: FormData) {
  const password = formData.get("password");
  const confirmation = formData.get("confirmation");
  if (typeof password !== "string" || typeof confirmation !== "string" || password.length < 12 || password.length > 128 || password !== confirmation) {
    redirect("/invitacion?error=password");
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  if (!auth.user.invited_at || auth.user.user_metadata?.access_setup_completed_at) redirect("/invitacion?error=invalid");
  const { error } = await supabase.auth.updateUser({
    password,
    data: { ...auth.user.user_metadata, access_setup_completed_at: new Date().toISOString() },
  });
  if (error) redirect("/invitacion?error=password");
  redirect("/invitacion?password=updated");
}
