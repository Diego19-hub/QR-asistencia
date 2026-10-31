import { expect, test } from "./fixtures/qr005-test";

test("empleado ve únicamente su portal vinculado y no accede a administración", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("EMPLOYEE_EMAIL"), qr.fixture("EMPLOYEE_PASSWORD"));
  await expect(page).toHaveURL(/\/mi-qr(?:\?|$)/);
  await expect(page.getByRole("heading", { name: /Hola,/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hola, Synthetic" })).toBeVisible();
  await expect(page.getByText(qr.fixture("COMPANY_A_NAME"), { exact: false })).toHaveCount(2);
  await expect(page.getByText(qr.fixture("COMPANY_B_NAME"), { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mi credencial" })).toHaveCount(0);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?error=no-company/);
  await page.goto("/scanner");
  await expect(page).toHaveURL(/\/login\?error=no-company/);
  await page.goto("/mi-qr");
  await expect(page.getByRole("heading", { name: /Hola,/ })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.goto("/mi-qr");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("membresía de empleado inactiva no permite consultar el portal", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("INACTIVE_EMPLOYEE_EMAIL"), qr.fixture("INACTIVE_EMPLOYEE_PASSWORD"));
  await expect(page).toHaveURL(/\/login\?error=no-company/);
  await page.goto("/mi-qr");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("empleado sin expediente vinculado no recibe datos de otras personas", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("UNLINKED_EMPLOYEE_EMAIL"), qr.fixture("UNLINKED_EMPLOYEE_PASSWORD"));
  await expect(page).toHaveURL(/\/mi-qr(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Perfil de empleado no vinculado" })).toBeVisible();
  await expect(page.getByText(/No se mostraron datos de otras personas/)).toBeVisible();
});
