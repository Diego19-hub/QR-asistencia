import { CompanySettings } from "@/components/admin/company-settings";
import { getAuthRedirectUrl } from "@/lib/access/auth-redirect";

export default function SettingsPage() {
  const publicOrigin = getAuthRedirectUrl("confirm")?.origin ?? null;
  return <CompanySettings publicOrigin={publicOrigin} />;
}
