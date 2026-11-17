import { expect, test } from "./fixtures/qr005-test";

type MailpitMessage = {
  ID?: string;
  id?: string;
  To?: { Address?: string; address?: string }[];
  to?: { Address?: string; address?: string }[];
};

async function hasMailFor(mailpitUrl: URL, email: string) {
  const listResponse = await fetch(new URL("/api/v1/messages?limit=100", mailpitUrl));
  expect(listResponse.status).toBe(200);
  const payload = await listResponse.json() as { messages?: MailpitMessage[] } | MailpitMessage[];
  const messages = Array.isArray(payload) ? payload : payload.messages ?? [];
  return messages.some((message) => (message.To ?? message.to ?? [])
    .some((recipient) => (recipient.Address ?? recipient.address ?? "").toLowerCase() === email.toLowerCase()));
}

test("registro no envía confirmación, mantiene sesión 30 días y entra al dashboard como Owner", async ({ browser, page, qr }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Crear empresa", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Crear empresa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Crear cuenta y empresa" })).toBeVisible();

  const email = `owner-${crypto.randomUUID()}@qr-asistencia.invalid`;
  const companyName = `Empresa de prueba ${crypto.randomUUID()}`;
  const password = `Synthetic-${crypto.randomUUID()}-Aa7`;
  await page.getByLabel("Nombre completo del propietario").fill("Propietaria QA Sintética");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByLabel("Confirmar contraseña").fill(password);
  await page.getByLabel("Nombre de la empresa").fill(companyName);
  await page.getByRole("radio", { name: "Persona física con actividad empresarial" }).check();
  await page.getByLabel("Razón social *").fill("Titular QA Sintético");
  await page.getByLabel("Domicilio de la empresa *").fill("Domicilio de prueba, sin datos reales");
  await page.getByLabel("RFC *").fill("abcd010203xyz");
  await page.getByLabel("Número de registro patronal *").fill("RP-QA-SINTETICO");
  await page.getByRole("button", { name: "Crear cuenta y empresa" }).click();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("main").getByText(companyName, { exact: true })).toBeVisible();
  expect(await hasMailFor(qr.mailpitUrl, email)).toBe(false);
  const sessionCookies = await page.context().cookies(qr.baseUrl.href);
  const rememberCookie = sessionCookies.find((cookie) => cookie.name === "qr_remember_session");
  expect(rememberCookie?.httpOnly).toBe(true);
  expect(rememberCookie?.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 24 * 60 * 60);
  expect(rememberCookie?.expires).toBeLessThan(Date.now() / 1000 + 31 * 24 * 60 * 60);
  const authCookies = sessionCookies.filter((cookie) => cookie.name.startsWith("sb-"));
  expect(authCookies.length).toBeGreaterThan(0);
  expect(authCookies.every((cookie) => cookie.expires > Date.now() / 1000 + 29 * 24 * 60 * 60)).toBe(true);
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("main").getByText(companyName, { exact: true })).toBeVisible();
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }) as { status: number; body: { user?: { id?: string }; memberships?: { companyId: string; companyName: string; role: string }[] } };
  expect(identity.status).toBe(200);
  expect(identity.body.memberships).toEqual([{ companyName, role: "owner", companyId: expect.any(String) }]);
  expect(identity.body.user?.id).toBeTruthy();
  const companyDetails = await page.evaluate(async () => fetch("/api/company", { cache: "no-store" }).then((response) => response.json()));
  expect(companyDetails.item?.taxpayer_type).toBe("physical_person_business");
  const createdCompanyId = identity.body.memberships?.[0]?.companyId;
  if (!createdCompanyId) throw new Error("Owner registration response did not include the created company ID");

  const foreignContext = await browser.newContext();
  await qr.guardBrowserOrigins(foreignContext);
  const foreignPage = await foreignContext.newPage();
  try {
    await qr.signIn(foreignPage, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
    await expect(foreignPage).toHaveURL(/\/admin(?:\?|$)/);
    const foreignIdentityStatus = await foreignPage.evaluate(async () => fetch("/api/me", { cache: "no-store" }).then((response) => response.status));
    expect(foreignIdentityStatus).toBe(200);
    const denial = await foreignPage.evaluate(async (companyId) => fetch(`/api/company?companyId=${encodeURIComponent(companyId)}`, { cache: "no-store" }).then((response) => response.status), createdCompanyId);
    expect(denial).toBe(403);
  } finally {
    await foreignContext.close();
  }

  await page.goto("/crear-empresa");
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("main").getByText(companyName, { exact: true })).toBeVisible();
});

test("reintentar un correo existente no revela la cuenta ni cambia su contraseña", async ({ page, qr }) => {
  await page.goto("/crear-empresa");
  await page.getByLabel("Nombre completo del propietario").fill("Cuenta existente QA");
  await page.getByLabel("Correo electrónico").fill(qr.fixture("ADMIN_EMAIL"));
  await page.getByLabel("Contraseña", { exact: true }).fill("synthetic-known-password");
  await page.getByLabel("Confirmar contraseña").fill("synthetic-known-password");
  await page.getByLabel("Nombre de la empresa").fill("No debe duplicarse");
  await page.getByLabel("Razón social *").fill("Razón social sintética de reintento");
  await page.getByLabel("Domicilio de la empresa *").fill("Domicilio sintético de reintento");
  await page.getByRole("radio", { name: "Persona moral" }).check();
  await page.getByLabel("RFC *").fill("abc010203xyz");
  await page.getByLabel("Número de registro patronal *").fill("RP-QA-REINTENTO");
  await page.getByRole("button", { name: "Crear cuenta y empresa" }).click();
  await expect(page.locator("div[role=alert]").filter({ hasText: "No fue posible completar el registro" }))
    .toHaveText("No fue posible completar el registro. Revisa los datos o, si ya tienes cuenta, inicia sesión.");
  await expect(page.getByText("User already registered", { exact: false })).toHaveCount(0);
  await qr.signIn(page, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
});
