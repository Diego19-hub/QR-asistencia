import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { companySelectionPathForAccessDestination, loginPathForAccessDestination } from "@/lib/access/access-links";

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) redirect(loginPathForAccessDestination("/mi-qr"));
  const { data: memberships, error: membershipError } = await supabase.from("company_memberships")
    .select("id,role").eq("user_id", auth.user.id).eq("active", true);
  if (membershipError) redirect("/login?error=service");
  const employeeMemberships = (memberships ?? []).filter((membership) => membership.role === "employee");
  const selectedId = (await cookies()).get("qr_active_membership_id")?.value;
  const selected = selectedId ? employeeMemberships.find((membership) => membership.id === selectedId) : null;
  const sole = memberships?.length === 1 && employeeMemberships.length === 1 ? employeeMemberships[0] : null;
  if (!employeeMemberships.length) redirect("/login?error=no-company");
  if (!selected && !sole) redirect(companySelectionPathForAccessDestination("/mi-qr"));
  return children;
}
