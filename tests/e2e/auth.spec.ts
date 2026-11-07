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

test("sesión elegida persiste de forma segura, retoma empresa y rol, y cerrar sesión la invalida", async ({ browser, page, qr }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(qr.fixture("MULTI_ADMIN_EMAIL"));
  await page.getByLabel("Contraseña").fill(qr.fixture("MULTI_ADMIN_PASSWORD"));
  await page.getByLabel("Mantener sesión iniciada en este dispositivo").check();
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/seleccionar-empresa/);

  const membershipId = qr.fixture("MULTI_ADMIN_COMPANY_B_MEMBERSHIP_ID");
  const ownCompanyChoice = page.locator("form").filter({ has: page.locator(`input[name='membershipId'][value='${membershipId}']`) });
  await ownCompanyChoice.getByRole("button").click();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("main").getByText(qr.fixture("COMPANY_B_NAME"), { exact: true })).toBeVisible();

  const cookies = await page.context().cookies(qr.baseUrl.href);
  const rememberCookie = cookies.find((cookie) => cookie.name === "qr_remember_session");
  expect(rememberCookie?.httpOnly).toBe(true);
  expect(rememberCookie?.expires).toBeGreaterThan(Date.now() / 1000);
  const authCookies = cookies.filter((cookie) => cookie.name.startsWith("sb-"));
  expect(authCookies.length).toBeGreaterThan(0);
  expect(authCookies.every((cookie) => cookie.expires > Date.now() / 1000)).toBe(true);
  const activeMembership = cookies.find((cookie) => cookie.name === "qr_active_membership_id");
  expect(activeMembership?.value).toBe(membershipId);

  // Simulate reopening the app with only cookies that survive closing the browser.
  const reopenedContext = await browser.newContext({ storageState: { cookies, origins: [] } });
  const reopenedPage = await reopenedContext.newPage();
  await reopenedPage.goto(new URL("/login", qr.baseUrl).href);
  await expect(reopenedPage).toHaveURL(/\/admin(?:\?|$)/);
  await expect(reopenedPage.getByRole("main").getByText(qr.fixture("COMPANY_B_NAME"), { exact: true })).toBeVisible();

  await reopenedPage.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(reopenedPage).toHaveURL(/\/login(?:\?|$)/);
  const afterSignOut = await reopenedContext.cookies(qr.baseUrl.href);
  expect(afterSignOut.some((cookie) => cookie.name === "qr_remember_session")).toBe(false);
  expect(afterSignOut.some((cookie) => cookie.name.startsWith("sb-"))).toBe(false);
  const meResponse = await reopenedPage.evaluate(async () => fetch("/api/me").then((response) => response.status));
  expect(meResponse).toBe(401);
  await reopenedContext.close();
});

test("sin la opción, la sesión funciona durante el navegador pero no sobrevive al cierre", async ({ browser, page, qr }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Mantener sesión iniciada en este dispositivo")).not.toBeChecked();
  await page.getByLabel("Correo electrónico").fill(qr.fixture("ADMIN_EMAIL"));
  await page.getByLabel("Contraseña").fill(qr.fixture("ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);

  const cookies = await page.context().cookies(qr.baseUrl.href);
  const authCookies = cookies.filter((cookie) => cookie.name.startsWith("sb-"));
  expect(authCookies.length).toBeGreaterThan(0);
  expect(authCookies.every((cookie) => cookie.expires === -1)).toBe(true);
  expect(cookies.some((cookie) => cookie.name === "qr_remember_session")).toBe(false);
  await page.reload();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);

  // Session cookies are intentionally omitted to model a new browser session.
  const retainedCookies = cookies.filter((cookie) => !cookie.name.startsWith("sb-") && cookie.expires > Date.now() / 1000);
  const reopenedContext = await browser.newContext({ storageState: { cookies: retainedCookies, origins: [] } });
  const reopenedPage = await reopenedContext.newPage();
  await reopenedPage.goto(new URL("/admin", qr.baseUrl).href);
  await expect(reopenedPage).toHaveURL(/\/login(?:\?|$)/);
  await reopenedContext.close();

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  expect((await page.context().cookies(qr.baseUrl.href)).some((cookie) => cookie.name.startsWith("sb-"))).toBe(false);
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
