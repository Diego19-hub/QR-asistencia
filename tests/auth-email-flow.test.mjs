import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const redirect = await import("../src/lib/access/auth-redirect.ts");
const invitationPassword = await import("../src/lib/access/invitation-password.ts");
const appUrl = "https://asistencia-test.duob.tech";

test("Invitation setup validates the configured password bounds and a presentation-only full name", async () => {
  const [page, actions, localAuthConfig] = await Promise.all([
    readFile(new URL("../src/app/(auth)/invitacion/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(auth)/invitacion/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Completar cuenta y aceptar invitación/);
  assert.match(page, /Correo de la invitación/);
  assert.match(page, /Correo confirmado por Supabase Auth/);
  assert.match(page, /name="fullName"/);
  assert.match(page, /Nombre completo/);
  assert.match(page, /El nombre se guarda solo como dato de presentación/);
  assert.equal((page.match(/minLength=\{INVITATION_PASSWORD_MIN_LENGTH\}/g) ?? []).length, 2);
  assert.match(actions, /isValidInvitationPassword\(password, confirmation\)/);
  assert.match(actions, /normalizeInvitationFullName\(formData\.get\("fullName"\)\)/);
  assert.match(actions, /auth\.user\.email_confirmed_at/);
  assert.match(actions, /list_my_pending_company_invitations/);
  assert.match(actions, /data: \{ full_name: fullName \}/);
  assert.match(localAuthConfig, /^minimum_password_length\s*=\s*6$/m);
  assert.match(localAuthConfig, /^enable_signup\s*=\s*false$/m);
  assert.equal(invitationPassword.isValidInvitationPassword("123456", "123456"), true);
  assert.equal(invitationPassword.isValidInvitationPassword("12345", "12345"), false);
  assert.equal(invitationPassword.isValidInvitationPassword("a".repeat(128), "a".repeat(128)), true);
  assert.equal(invitationPassword.isValidInvitationPassword("a".repeat(129), "a".repeat(129)), false);
  assert.equal(invitationPassword.isValidInvitationPassword("123456", "654321"), false);
  assert.equal(invitationPassword.isValidInvitationPassword(null, null), false);
  assert.equal(invitationPassword.normalizeInvitationFullName("  Ana   María Ortega  "), "Ana María Ortega");
  assert.equal(invitationPassword.normalizeInvitationFullName("李 小龍"), "李 小龍");
  assert.equal(invitationPassword.normalizeInvitationFullName(" "), null);
  assert.equal(invitationPassword.normalizeInvitationFullName("A"), null);
  assert.equal(invitationPassword.normalizeInvitationFullName("Name\nWith control"), null);
  assert.equal(invitationPassword.normalizeInvitationFullName("N".repeat(121)), null);
  assert.equal(invitationPassword.hasCompletedInvitationAccountSetup("2026-01-01T00:00:00.000Z", Date.parse("2026-01-02T00:00:00.000Z")), true);
  assert.equal(invitationPassword.hasCompletedInvitationAccountSetup("not-a-date"), false);
  assert.equal(invitationPassword.hasCompletedInvitationAccountSetup("2999-01-01T00:00:00.000Z"), false);
});

test("Auth redirects use APP_BASE_URL and a closed set of paths", () => {
  assert.equal(redirect.getAuthRedirectUrl("confirm", appUrl, "production").href, `${appUrl}/auth/confirm`);
  assert.equal(redirect.getAuthRedirectUrl("callback-invitation", appUrl, "production").href, `${appUrl}/auth/callback?next=%2Finvitacion`);
  assert.equal(redirect.getAuthRedirectUrl("../evil", appUrl, "production"), null);
  assert.equal(redirect.getAuthRedirectUrl("confirm", "https://user:pass@asistencia-test.duob.tech", "production"), null);
  assert.equal(redirect.getAuthRedirectUrl("confirm", "https://asistencia-test.duob.tech/other", "production"), null);
  assert.equal(redirect.getAuthRedirectUrl("confirm", "http://0.0.0.0:3000", "production"), null);
  assert.equal(redirect.getAuthRedirectUrl("confirm", "http://localhost:3000", "production"), null);
});

test("Token-hash links are built for one fixed endpoint and accepted email types", () => {
  const invite = redirect.getEmailTokenConfirmationUrl("invite", "one-time-token-hash", appUrl, "production");
  const parsed = new URL(invite);
  assert.equal(parsed.origin, appUrl);
  assert.equal(parsed.pathname, "/auth/confirm");
  assert.equal(parsed.searchParams.get("token_hash"), "one-time-token-hash");
  assert.equal(parsed.searchParams.get("type"), "invite");
  assert.equal(redirect.getEmailTokenConfirmationUrl("magiclink", "hash", appUrl, "production")?.includes("type=magiclink"), true);
  assert.equal(redirect.getEmailTokenConfirmationUrl("invite", "bad\nhash", appUrl, "production"), null);
  assert.equal(redirect.getAuthRedirectLocation("login-invite-error", appUrl, "production").endsWith("#"), true);
});

test("Invite and magic-link templates use the SSR token_hash endpoint", async () => {
  const [config, inviteTemplate, magicTemplate, delivery] = await Promise.all([
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../supabase/templates/invite.html", import.meta.url), "utf8"),
    readFile(new URL("../supabase/templates/magic_link.html", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/access/invitation-delivery.ts", import.meta.url), "utf8"),
  ]);
  assert.match(config, /\[auth\.email\.template\.invite\][\s\S]*?content_path = "\.\/supabase\/templates\/invite\.html"/);
  assert.match(config, /\[auth\.email\.template\.magic_link\][\s\S]*?content_path = "\.\/supabase\/templates\/magic_link\.html"/);
  assert.match(inviteTemplate, /\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}&amp;type=invite/);
  assert.match(magicTemplate, /\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}&amp;type=magiclink/);
  for (const template of [inviteTemplate, magicTemplate]) {
    assert.doesNotMatch(template, /ConfirmationURL|access_token|refresh_token|action_link/i);
  }
  assert.match(delivery, /properties\?\.hashed_token/);
  assert.match(delivery, /getEmailTokenConfirmationUrl\("magiclink"/);
  assert.doesNotMatch(delivery, /properties\?\.action_link/);
});

test("Auth routes verify server-side and never redirect using request.url or token fragments", async () => {
  const [callback, confirm] = await Promise.all([
    readFile(new URL("../src/app/auth/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/auth/confirm/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(callback, /exchangeCodeForSession\(code\)/);
  assert.match(callback, /getAuthRedirectLocation/);
  assert.match(confirm, /verifyOtp\(\{ token_hash: tokenHash, type \}\)/);
  assert.match(confirm, /form method="post" action="\/auth\/confirm"/);
  assert.match(confirm, /export async function POST\(request: NextRequest\)/);
  assert.match(confirm, /application\/x-www-form-urlencoded/);
  assert.match(confirm, /one-time OTP on a link preview/);
  for (const source of [callback, confirm]) {
    assert.doesNotMatch(source, /request\.url/);
    assert.match(source, /Referrer-Policy.*no-referrer/);
    assert.match(source, /Cache-Control.*no-store/);
    assert.match(source, /Location", location/);
    assert.doesNotMatch(source, /access_token|refresh_token/);
  }
  assert.match(confirm, /if \(error\) return redirectAuth\("login-invite-error"\)/);
});

test("Invitation setup revalidates Auth identity and pending recipient before changing password or profile", async () => {
  const [actions, page, acceptanceMigration, inviteApi, delivery, resend] = await Promise.all([
    readFile(new URL("../src/app/(auth)/invitacion/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(auth)/invitacion/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20261105234619_invitation_account_setup_required.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/admin/access/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/access/invitation-delivery.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/access/resend-invitation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(actions, /await supabase\.auth\.getUser\(\)/);
  assert.match(actions, /auth\.user\.email_confirmed_at/);
  assert.match(actions, /list_my_pending_company_invitations/);
  assert.match(actions, /data: \{ full_name: fullName \}/);
  assert.match(actions, /createAuthAdminClient\(\)/);
  assert.match(actions, /updateUserById\(auth\.user\.id,[\s\S]*app_metadata:[\s\S]*access_setup_completed_at/);
  const adminClientCheck = actions.indexOf("const admin = createAuthAdminClient();", actions.indexOf("export async function setInvitationPassword"));
  const passwordWrite = actions.indexOf("supabase.auth.updateUser({ password, data: { full_name: fullName } })", adminClientCheck);
  const metadataWrite = actions.indexOf("admin.auth.admin.updateUserById", passwordWrite);
  assert.ok(adminClientCheck >= 0 && adminClientCheck < passwordWrite && passwordWrite < metadataWrite, "admin client configuration is checked before password mutation; server marker write follows the authenticated password change");
  assert.match(actions, /hasMatchingInvitation/);
  assert.match(page, /hasCompletedInvitationAccountSetup/);
  assert.match(page, /emailVerified/);
  assert.doesNotMatch(page, /<input[^>]+name="email"/);
  assert.match(actions, /accept_company_user_invitation/);
  assert.match(actions, /destinationForRole\(membership\.role/);
  assert.match(actions, /\/seleccionar-empresa/);
  assert.match(acceptanceMigration, /raw_app_meta_data->>'access_setup_completed_at'/);
  assert.doesNotMatch(acceptanceMigration, /raw_user_meta_data|invited_at/);
  assert.match(inviteApi, /La persona aún no puede iniciar sesión ni aceptar esta invitación/);
  assert.match(delivery, /https:\/\/api\.resend\.com\/emails/);
  assert.match(delivery, /QR_AUTH_LOCAL_TEST/);
  assert.match(resend, /la persona debe abrir el enlace, completar su cuenta y después aceptar/);
});
