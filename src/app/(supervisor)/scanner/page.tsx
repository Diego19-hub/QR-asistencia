import { MobileScanner } from "@/components/scanner/mobile-scanner";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function ScannerPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  return <MobileScanner />;
}
