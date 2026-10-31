import { expect, test } from "./fixtures/qr005-test";

test("selección explícita permite cambiar entre las empresas propias", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("MULTI_ADMIN_EMAIL"), qr.fixture("MULTI_ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/seleccionar-empresa(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Elige empresa y rol" })).toBeVisible();
  const companyA = qr.fixture("COMPANY_A_NAME");
  const companyB = qr.fixture("COMPANY_B_NAME");
  const options = page.getByRole("button", { name: /Continuar/ });
  await expect(options).toHaveCount(2);

  await page.getByRole("button", { name: new RegExp(`${companyB}.*Continuar`) }).click();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("combobox", { name: "Empresa activa" })).toHaveValue(qr.fixture("COMPANY_B_ID"));
  await expect(page.getByRole("main").getByText(companyB, { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText(companyA, { exact: true })).toHaveCount(0);
  await page.goto("/seleccionar-empresa");
  await page.getByRole("button", { name: new RegExp(`${companyA}.*Continuar`) }).click();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("combobox", { name: "Empresa activa" })).toHaveValue(qr.fixture("COMPANY_A_ID"));
  const cookie = (await page.context().cookies(qr.baseUrl.href)).find((item) => item.name === "qr_active_membership_id");
  expect(cookie?.httpOnly).toBe(true);
});

test("la selección rechaza una membresía perteneciente a otra identidad", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("MULTI_ADMIN_EMAIL"), qr.fixture("MULTI_ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/seleccionar-empresa(?:\?|$)/);
  const selection = page.locator('form').filter({ has: page.getByRole("button", { name: /Continuar/ }) }).first();
  await selection.locator('input[name="membershipId"]').evaluate((input, value) => { (input as HTMLInputElement).value = value; }, qr.fixture("FOREIGN_MEMBERSHIP_ID"));
  await selection.getByRole("button", { name: /Continuar/ }).evaluate((button) => (button as HTMLButtonElement).form?.requestSubmit(button as HTMLButtonElement));
  await expect(page).toHaveURL(/\/seleccionar-empresa\?error=invalid/);
  await expect(page.getByText(/La opción dejó de estar disponible/)).toBeVisible();
  expect((await page.context().cookies(qr.baseUrl.href)).some((cookie) => cookie.name === "qr_active_membership_id")).toBe(false);
});
