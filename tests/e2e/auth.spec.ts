import { expect, test } from "./fixtures/qr005-test";

test("rutas protegidas redirigen a login sin sesión", async ({ page }) => {
  for (const path of ["/admin", "/scanner", "/mi-qr"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  }
});

test("login administrativo real, error de contraseña y cierre de sesión", async ({ page, qr }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(qr.fixture("ADMIN_EMAIL"));
  await page.getByLabel("Contraseña").fill("incorrect-synthetic-password-only");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("No se pudo iniciar sesión.", { exact: false })).toBeVisible();
  expect((await page.context().cookies(qr.baseUrl.href)).some((cookie) => cookie.name.startsWith("sb-"))).toBe(false);

  await qr.signIn(page, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("link", { name: "Empleados", exact: true })).toBeVisible();
  const membershipCookie = (await page.context().cookies(qr.baseUrl.href)).find((cookie) => cookie.name === "qr_active_membership_id");
  expect(membershipCookie?.httpOnly).toBe(true);
  await page.getByRole("button", { name: "Cerrar sesión" }).evaluate((button) => (button as HTMLButtonElement).form?.requestSubmit(button as HTMLButtonElement));
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("dashboard administrativo carga la empresa sintética y enlaces principales", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Resumen de asistencia" })).toBeVisible();
  await expect(page.getByRole("main").getByText(qr.fixture("COMPANY_A_NAME"), { exact: true })).toBeVisible();
  await expect(page.getByText(/Fecha operativa ·/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver empleados" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Horarios", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await expect(page.getByRole("link", { name: "Supervisores y dispositivos", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Asistencias", exact: true }).click();
  await expect(page.getByRole("link", { name: "Reportes", exact: true })).toBeVisible();
});

test("dashboard informa falla de red y permite recuperar la carga", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByText(/Fecha operativa ·/)).toBeVisible();
  let intercepted = false;
  await page.route(/dashboard\/summary/, async (route) => {
    if (!intercepted) {
      intercepted = true;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Falla sintética temporal" } }) });
    }
    return route.continue();
  });
  await page.getByRole("combobox", { name: "Filtrar por sucursal" }).selectOption(qr.fixture("BRANCH_A_ID"));
  await expect.poll(() => intercepted).toBe(true);
  await expect(page.getByText("No se pudo cargar la información", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByText(/Fecha operativa ·/)).toBeVisible();
  await expect(page.getByText("No se pudo cargar la información", { exact: true })).toHaveCount(0);
});
