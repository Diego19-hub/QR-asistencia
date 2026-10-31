import { expect, test } from "./fixtures/qr005-test";

test("supervisor autorizado abre el escáner y un rol insuficiente no entra a administración", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("SUPERVISOR_EMAIL"), qr.fixture("SUPERVISOR_PASSWORD"));
  await expect(page).toHaveURL(/\/scanner(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
  await expect(page.getByText("Dispositivo sin autorización")).toBeVisible();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?error=no-company/);
  await expect(page.getByText("Tu cuenta aún no está asignada a una empresa.", { exact: false })).toBeVisible();
});

test("cuentas sin membresía activa no alcanzan rutas protegidas", async ({ page, qr }) => {
  for (const key of ["NO_MEMBERSHIP", "INACTIVE_MEMBERSHIP", "INACTIVE_EMPLOYEE"]) {
    await qr.signIn(page, qr.fixture(`${key}_EMAIL`), qr.fixture(`${key}_PASSWORD`));
    await expect(page).toHaveURL(/\/login\?error=no-company/);
    await expect(page.getByText("Tu cuenta aún no está asignada a una empresa.", { exact: false })).toBeVisible();
  }
});

test("una membresía revocada deja de autorizar la ruta del escáner", async ({ page, browser, qr }) => {
  await qr.signIn(page, qr.fixture("REVOKED_SUPERVISOR_EMAIL"), qr.fixture("REVOKED_SUPERVISOR_PASSWORD"));
  if (new URL(page.url()).pathname === "/scanner") {
    await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
    const adminContext = await browser.newContext();
    await qr.guardBrowserOrigins(adminContext);
    const adminPage = await adminContext.newPage();
    try {
      await qr.signIn(adminPage, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
      const companyId = qr.fixture("COMPANY_A_ID");
      const membershipId = qr.fixture("REVOKED_SUPERVISOR_MEMBERSHIP_ID");
      const status = await adminPage.evaluate(async ({ companyId: selectedCompanyId, membershipId: targetMembershipId }) => {
        const response = await fetch(`/api/admin/access?companyId=${selectedCompanyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deactivate", membershipId: targetMembershipId }),
        });
        return response.status;
      }, { companyId, membershipId });
      expect(status).toBe(200);
    } finally {
      await adminContext.close();
    }
  }
  await page.goto("/scanner");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});
