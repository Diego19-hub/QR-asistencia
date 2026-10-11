import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import type { CompanyOption } from "@/components/admin/admin-context";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const { data: memberships, error: membershipError } = await supabase
    .from("company_memberships")
    .select("company_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .in("role", ["owner", "admin"]);
  if (membershipError) redirect("/login?error=service");
  if (!memberships?.length) redirect("/login?error=no-company");

  const companyIds = [...new Set(memberships.map(({ company_id }) => company_id))];
  const { data: companyRows, error: companiesError } = await supabase
    .from("companies")
    .select("id, name")
    .in("id", companyIds);
  if (companiesError || !companyRows?.length) redirect("/login?error=service");

  const companyNames = new Map(companyRows.map(({ id, name }) => [id, name]));
  const companies: CompanyOption[] = memberships.flatMap((membership) => {
    const companyName = companyNames.get(membership.company_id);
    return companyName ? [{ companyId: membership.company_id, companyName, role: membership.role as CompanyOption["role"] }] : [];
  });
  if (!companies.length) redirect("/login?error=no-company");

  return <AdminShell userName={user.email ?? "Administrador"} companies={companies} initialCompany={companies[0]}>{children}</AdminShell>;
}
