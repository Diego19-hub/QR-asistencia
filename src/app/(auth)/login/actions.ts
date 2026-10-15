"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { destinationForRole, selectInitialMembership, type MembershipRole } from "@/lib/access/user-management";
import { clearActiveMembershipCookie, setActiveMembershipCookie } from "@/lib/access/active-membership-cookie";

export async function signIn(formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    redirect("/login?error=invalid");
  }

  let signInError: Error | null = null;
  let authStatus: number | undefined;
  let destination: string | null = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    signInError = error;
    authStatus = (error as (Error & { status?: number }) | null)?.status;
    if (!error && data.user) {
      const { data: memberships, error: membershipError } = await supabase
        .from("company_memberships")
        .select("id,company_id,role")
        .eq("user_id", data.user.id)
        .eq("active", true);

      if (membershipError) destination = "/login?error=service";
      else {
        const { data: pending, error: invitationError } = await supabase.rpc("list_my_pending_company_invitations");
        const invitationFunctionMissing = invitationError?.code === "PGRST202" || invitationError?.code === "42883";
        if (invitationError && !invitationFunctionMissing) destination = "/login?error=service";
        else if (Array.isArray(pending) && pending.length) destination = "/invitacion";
        else {
          const choices = (memberships ?? []).map((membership) => ({
            companyId: membership.company_id,
            role: membership.role as MembershipRole,
            membershipId: membership.id,
          }));
          const selected = selectInitialMembership(choices);
          if (selected.kind === "none") destination = "/login?error=no-company";
          else if (selected.kind === "choose") destination = "/seleccionar-empresa";
          else {
            await setActiveMembershipCookie(selected.membership.membershipId ?? "");
            destination = destinationForRole(selected.membership.role);
          }
        }
      }
    }
  } catch {
    redirect("/login?error=service");
  }

  if (signInError) {
    if (authStatus === 429 || (authStatus !== undefined && authStatus >= 500)) {
      redirect("/login?error=service");
    }
    redirect("/login?error=credentials");
  }

  redirect(destination ?? "/login?error=service");
}

export async function signOut() {
  let failed = false;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    failed = Boolean(error);
  } catch {
    failed = true;
  }

  if (failed) {
    redirect("/admin?error=signout");
  }

  await clearActiveMembershipCookie();

  redirect("/login");
}
