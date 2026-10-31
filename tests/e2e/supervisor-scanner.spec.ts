import { expect, test } from "./fixtures/qr005-test";

test("dispositivo local se solicita, aprueba y revoca sin registrar asistencia", async ({ page, browser, qr }) => {
  const scanRequests: string[] = [];
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let cameraFailures = 0;
    navigator.mediaDevices.getUserMedia = async (...args) => {
      if (cameraFailures === 0) {
        cameraFailures += 1;
        throw new DOMException("Synthetic camera unavailable", "NotFoundError");
      }
      if (cameraFailures === 1) {
        cameraFailures += 1;
        throw new DOMException("Synthetic camera permission denial", "NotAllowedError");
      }
      return original(...args);
    };
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/attendance/scan") scanRequests.push(request.url());
  });
  await qr.signIn(page, qr.fixture("SUPERVISOR_EMAIL"), qr.fixture("SUPERVISOR_PASSWORD"));
  await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
  const deviceLabel = `QR005 fake camera ${Date.now()}`;
  await page.getByLabel("Nombre del dispositivo").fill(deviceLabel);
  await page.getByRole("button", { name: "Solicitar autorización" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitud enviada");

  const adminContext = await browser.newContext();
  await qr.guardBrowserOrigins(adminContext);
  const adminPage = await adminContext.newPage();
  try {
    await qr.signIn(adminPage, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
    await expect(adminPage).toHaveURL(/\/admin(?:\?|$)/);
    const companyId = qr.fixture("COMPANY_A_ID");
    const approval = await adminPage.evaluate(async ({ companyId: selectedCompanyId, label }) => {
      const listResponse = await fetch(`/api/supervisor-devices?companyId=${selectedCompanyId}`, { cache: "no-store" });
      const listed = await listResponse.json() as { requests?: { id: string; label: string; status: string }[] };
      const pending = (listed.requests ?? []).find((item) => item.label === label && item.status === "pending");
      if (!listResponse.ok || !pending) return { listStatus: listResponse.status, reviewStatus: null };
      const reviewResponse = await fetch(`/api/supervisor-devices?companyId=${selectedCompanyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: pending.id, approve: true }),
      });
      const reviewed = await reviewResponse.json();
      return { listStatus: listResponse.status, reviewStatus: reviewResponse.status, request: reviewed.request };
    }, { companyId, label: deviceLabel });
    expect(approval).toMatchObject({ listStatus: 200, reviewStatus: 200 });
    expect(approval.request.status).toBe("approved");

    await page.reload();
    await expect(page.getByText("Dispositivo autorizado")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Escanear no registra la asistencia/)).toBeVisible();

    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByText("No se pudo abrir la cámara.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByText("No se pudo abrir la cámara.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByRole("button", { name: "Cerrar cámara" })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar cámara" }).click();

    const revocation = await adminPage.evaluate(async ({ companyId: selectedCompanyId, label }) => {
      const listResponse = await fetch(`/api/supervisor-devices?companyId=${selectedCompanyId}`, { cache: "no-store" });
      const listed = await listResponse.json() as { devices?: { id: string; label: string; active: boolean }[] };
      const device = (listed.devices ?? []).find((item) => item.label === label && item.active);
      if (!listResponse.ok || !device) return { listStatus: listResponse.status, revokeStatus: null };
      const revokeResponse = await fetch(`/api/supervisor-devices/${device.id}?companyId=${selectedCompanyId}`, { method: "DELETE" });
      return { listStatus: listResponse.status, revokeStatus: revokeResponse.status };
    }, { companyId, label: deviceLabel });
    expect(revocation).toEqual({ listStatus: 200, revokeStatus: 200 });
    await page.reload();
    await expect(page.getByText("Dispositivo sin autorización")).toBeVisible();

    const membershipId = qr.fixture("SUPERVISOR_MEMBERSHIP_ID");
    const revokeMembership = await adminPage.evaluate(async ({ companyId: selectedCompanyId, membershipId: targetMembershipId }) => {
      const response = await fetch(`/api/admin/access?companyId=${selectedCompanyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate", membershipId: targetMembershipId }),
      });
      return response.status;
    }, { companyId, membershipId });
    expect(revokeMembership).toBe(200);
    await page.goto("/scanner");
    await expect(page).toHaveURL(/\/login\?error=no-company/);
    expect(scanRequests).toHaveLength(0);
  } finally {
    await adminContext.close();
  }
});

test("supervisor sin sucursal conserva la denegación de contexto", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("NO_BRANCH_SUPERVISOR_EMAIL"), qr.fixture("NO_BRANCH_SUPERVISOR_PASSWORD"));
  await expect(page).toHaveURL(/\/scanner(?:\?|$)/);
  await expect(page.getByText("Sin sucursal asignada.")).toBeVisible();
});

test("supervisor con membresías en dos empresas solo habilita el contexto de cada empresa", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("MULTI_SUPERVISOR_EMAIL"), qr.fixture("MULTI_SUPERVISOR_PASSWORD"));
  await expect(page).toHaveURL(/\/seleccionar-empresa(?:\?|$)/);
  await page.getByRole("button", { name: new RegExp(`${qr.fixture("COMPANY_B_NAME")}.*Continuar`) }).click();
  await expect(page).toHaveURL(/\/scanner(?:\?|$)/);
  await expect(page.getByText("Dispositivo sin autorización")).toBeVisible();
  await expect(page.getByText(qr.fixture("COMPANY_B_NAME"), { exact: false })).toBeVisible();
  await expect(page.getByText(qr.fixture("COMPANY_A_NAME"), { exact: false })).toHaveCount(0);
  const denied = await page.evaluate(async (companyId) => {
    const response = await fetch(`/api/supervisor/scanner/context?companyId=${companyId}`, { method: "POST" });
    return response.status;
  }, qr.fixture("COMPANY_A_ID"));
  expect(denied).toBe(403);
});

test("fallo transitorio de red en contexto muestra error y se recupera sin iniciar asistencia", async ({ page, qr }) => {
  let contextRequests = 0;
  const attendanceRequests: string[] = [];
  await page.route("**/api/supervisor/scanner/context", (route) => {
    contextRequests += 1;
    return contextRequests === 1 ? route.abort("failed") : route.continue();
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/attendance/scan") attendanceRequests.push(request.url());
  });
  await qr.signIn(page, qr.fixture("NETWORK_SUPERVISOR_EMAIL"), qr.fixture("NETWORK_SUPERVISOR_PASSWORD"));
  await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
  await expect(page.locator('div[role="alert"]').filter({ hasText: /Failed to fetch|NetworkError|No fue posible cargar/ })).toBeVisible();
  await expect(page.getByText("Dispositivo sin autorización")).toBeVisible({ timeout: 20_000 });
  expect(contextRequests).toBeGreaterThanOrEqual(2);
  expect(attendanceRequests).toHaveLength(0);
});
