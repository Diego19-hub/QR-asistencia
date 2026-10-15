import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const redirect = await import("../src/lib/access/auth-redirect.ts");
const invitationPassword = await import("../src/lib/access/invitation-password.ts");
const appUrl = "https://asistencia-test.duob.tech";

test("Invitation passwords accept 6 to 128 characters and require matching values", async () => {
  const [page, actions, localAuthConfig] = await Promise.all([
    readFile(new URL("../src/app/(auth)/invitacion/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(auth)/invitacion/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Contraseña de al menos 6 caracteres/);
  assert.equal((page.match(/minLength=\{6\}/g) ?? []).length, 2);
  assert.doesNotMatch(page, /minLength=\{12\}|al menos 12 caracteres/);
  assert.match(actions, /isValidInvitationPassword\(password, confirmation\)/);
  assert.match(localAuthConfig, /^minimum_password_length\s*=\s*6$/m);
  assert.equal(invitationPassword.isValidInvitationPassword("123456", "123456"), true);
  assert.equal(invitationPassword.isValidInvitationPassword("12345", "12345"), false);
  assert.equal(invitationPassword.isValidInvitationPassword("a".repeat(128), "a".repeat(128)), true);
  assert.equal(invitationPassword.isValidInvitationPassword("a".repeat(129), "a".repeat(129)), false);
  assert.equal(invitationPassword.isValidInvitationPassword("123456", "654321"), false);
  assert.equal(invitationPassword.isValidInvitationPassword(null, null), false);
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

test("Invitation setup keeps password and role acceptance on the authenticated SSR flow", async () => {
  const actions = await readFile(new URL("../src/app/(auth)/invitacion/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /await supabase\.auth\.getUser\(\)/);
  assert.match(actions, /updateUser\(\{[\s\S]*password,[\s\S]*access_setup_completed_at/);
  assert.match(actions, /accept_company_user_invitation/);
  assert.match(actions, /destinationForRole\(membership\.role/);
  assert.match(actions, /\/seleccionar-empresa/);
});
