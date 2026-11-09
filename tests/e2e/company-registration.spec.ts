import { expect, test } from "./fixtures/qr005-test";

type MailpitMessage = {
  ID?: string;
  id?: string;
  To?: { Address?: string; address?: string }[];
  to?: { Address?: string; address?: string }[];
};

async function confirmationUrl(mailpitUrl: URL, email: string, appOrigin: string) {
  const listResponse = await fetch(new URL("/api/v1/messages?limit=100", mailpitUrl));
  expect(listResponse.status).toBe(200);
  const payload = await listResponse.json() as { messages?: MailpitMessage[] } | MailpitMessage[];
  const messages = Array.isArray(payload) ? payload : payload.messages ?? [];
  const matching = messages.filter((message) => (message.To ?? message.to ?? [])
    .some((recipient) => (recipient.Address ?? recipient.address ?? "").toLowerCase() === email.toLowerCase()));
  expect(matching).toHaveLength(1);
  const id = matching[0].ID ?? matching[0].id;
  expect(typeof id).toBe("string");
  const detailResponse = await fetch(new URL(`/api/v1/message/${encodeURIComponent(id!)}`, mailpitUrl));
  expect(detailResponse.status).toBe(200);
  const detail = await detailResponse.json() as Record<string, unknown>;
  const body = [detail.HTML, detail.Text, detail.html, detail.text].filter((value): value is string => typeof value === "string").join("\n");
  const rawLink = /href\s*=\s*["']([^"'<>]*\/auth\/confirm\?[^"'<>]+)["']/i.exec(body)?.[1];
  expect(typeof rawLink).toBe("string");
  const url = new URL(rawLink!.replaceAll("&amp;", "&"));
  expect(url.origin).toBe(appOrigin);
  expect(url.pathname).toBe("/auth/confirm");
  expect(url.searchParams.get("type")).toBe("signup");
  expect(url.searchParams.get("token_hash")).toBeTruthy();
  return url;
}

test("registro confirma identidad antes de crear la empresa y asigna Owner a la identidad Auth", async ({ browser, page, qr }) => {
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
  await page.getByRole("button", { name: "Crear cuenta y empresa" }).click();
  await expect(page.getByRole("status")).toContainText("Te enviamos un correo para confirmar tu identidad");

  const link = await confirmationUrl(qr.mailpitUrl, email, qr.baseUrl.origin);
  await page.goto(link.href);
  await expect(page.getByRole("button", { name: "Confirmar correo" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar correo" }).click();
  await expect(page).toHaveURL(/\/crear-empresa(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Completar alta de empresa" })).toBeVisible();

  // No company exists until email confirmation and an authenticated completion.
  await page.getByLabel("Nombre de la empresa").fill(companyName);
  await page.getByRole("button", { name: "Crear empresa como Owner" }).click();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("main").getByText(companyName, { exact: true })).toBeVisible();
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }) as { status: number; body: { user?: { id?: string }; memberships?: { companyId: string; companyName: string; role: string }[] } };
  expect(identity.status).toBe(200);
  expect(identity.body.memberships).toEqual([{ companyName, role: "owner", companyId: expect.any(String) }]);
  expect(identity.body.user?.id).toBeTruthy();
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

test("correo ya registrado recibe una salida útil sin exponer detalles Auth", async ({ page, qr }) => {
  await page.goto("/crear-empresa");
  await page.getByLabel("Nombre completo del propietario").fill("Cuenta existente QA");
  await page.getByLabel("Correo electrónico").fill(qr.fixture("ADMIN_EMAIL"));
  await page.getByLabel("Contraseña", { exact: true }).fill("synthetic-known-password");
  await page.getByLabel("Confirmar contraseña").fill("synthetic-known-password");
  await page.getByLabel("Nombre de la empresa").fill("No debe duplicarse");
  await page.getByRole("button", { name: "Crear cuenta y empresa" }).click();
  await expect(page.getByText("Ese correo ya tiene una cuenta", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ir a iniciar sesión" })).toBeVisible();
  await expect(page.getByText("User already registered", { exact: false })).toHaveCount(0);
});
