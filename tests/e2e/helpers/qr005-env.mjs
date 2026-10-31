const baseUrl = new URL(required("QR005_BASE_URL"));
const supabaseUrl = new URL(required("QR005_SUPABASE_URL"));
const allowedOrigins = new Set([baseUrl.origin, supabaseUrl.origin]);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error("QR-005 E2E must be launched by its disposable local runner.");
  return value;
}

function assertLoopbackUrl(value, label) {
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(parsed.hostname)) {
    throw new Error(`${label} must use loopback in the QR-005 E2E suite`);
  }
  if (["llxyziffgtqnzlguxhyt", "jawdrhewabqajxnswhkn"].some((ref) => value.includes(ref))) {
    throw new Error(`${label} must not reference a hosted Supabase project`);
  }
}

assertLoopbackUrl(baseUrl.href, "Next.js URL");
assertLoopbackUrl(supabaseUrl.href, "Supabase URL");

export function fixture(name) {
  const value = process.env[`QR005_${name}`];
  if (!value) throw new Error(`Missing synthetic QR-005 fixture: ${name}`);
  return value;
}

export async function signIn(page, email, password) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

export async function guardBrowserOrigins(context) {
  await context.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return allowedOrigins.has(origin) ? route.continue() : route.abort("blockedbyclient");
  });
}

export function qr005Environment() {
  return { baseUrl, supabaseUrl, allowedOrigins, fixture, signIn, guardBrowserOrigins };
}
