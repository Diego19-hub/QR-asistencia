import { MobileScanner } from "@/components/scanner/mobile-scanner";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function ScannerPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  const { data: memberships, error: membershipError } = await supabase.from("company_memberships")
    .select("id,role").eq("user_id", data.user.id).eq("active", true);
  if (membershipError) redirect("/login?error=service");
  const supervisorMemberships = (memberships ?? []).filter((membership) => membership.role === "supervisor");
  const selectedId = (await cookies()).get("qr_active_membership_id")?.value;
  const selected = selectedId ? supervisorMemberships.find((membership) => membership.id === selectedId) : null;
  const sole = memberships?.length === 1 && supervisorMemberships.length === 1 ? supervisorMemberships[0] : null;
  if (!supervisorMemberships.length) redirect("/login?error=no-company");
  if (!selected && !sole) redirect("/seleccionar-empresa");
  return <MobileScanner />;
}
