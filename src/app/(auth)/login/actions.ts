"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
        .select("role")
        .eq("user_id", data.user.id)
        .eq("active", true);

      if (membershipError) destination = "/login?error=service";
      else if (!memberships?.length) destination = "/login?error=no-company";
      else if (memberships.some(({ role }) => role === "owner" || role === "admin")) destination = "/admin";
      else if (memberships.some(({ role }) => role === "supervisor")) destination = "/scanner";
      else if (memberships.some(({ role }) => role === "employee")) destination = "/mi-qr";
      else destination = "/login?error=no-company";
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

  redirect("/login");
}
