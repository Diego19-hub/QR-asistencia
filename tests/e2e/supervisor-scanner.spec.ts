import { expect, test } from "./fixtures/qr005-test";

type CameraTestWindow = Window & {
  __qr006CameraCalls?: number;
  __qr006Tracks?: MediaStreamTrack[];
  __qr006ReleaseInitialCamera?: () => void;
  __qr006ReleaseRevokedCamera?: () => void;
};

test("dispositivo local se solicita, aprueba y revoca sin registrar asistencia", async ({ page, browser, qr }) => {
  const scanRequests: string[] = [];
  await page.addInitScript(() => {
    const testWindow = window as CameraTestWindow;
    testWindow.__qr006CameraCalls = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let cameraFailures = 0;
    navigator.mediaDevices.getUserMedia = async (...args) => {
      testWindow.__qr006CameraCalls = (testWindow.__qr006CameraCalls ?? 0) + 1;
      if (cameraFailures === 0) {
        cameraFailures += 1;
        throw new DOMException("Synthetic camera unavailable", "NotFoundError");
      }
      if (cameraFailures === 1) {
        cameraFailures += 1;
        throw new DOMException("Synthetic camera permission denial", "NotAllowedError");
      }
      if (testWindow.__qr006CameraCalls === 3) {
        await new Promise<void>((resolve) => { testWindow.__qr006ReleaseInitialCamera = resolve; });
      }
      if (testWindow.__qr006CameraCalls === 5) {
        await new Promise<void>((resolve) => { testWindow.__qr006ReleaseRevokedCamera = resolve; });
      }
      const stream = await original(...args);
      testWindow.__qr006Tracks = [...(testWindow.__qr006Tracks ?? []), ...stream.getTracks()];
      return stream;
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
    await expect(page.getByText("No se encontró una cámara disponible", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByText("Se denegó el permiso de cámara", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Abrir cámara" }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => page.evaluate(() => (window as CameraTestWindow).__qr006CameraCalls)).toBe(3);
    await page.evaluate(() => (window as CameraTestWindow).__qr006ReleaseInitialCamera?.());
    await expect(page.getByRole("button", { name: "Cerrar cámara" })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar cámara" }).click();
    await expect.poll(() => page.evaluate(() => (window as CameraTestWindow).__qr006Tracks?.every((track) => track.readyState === "ended"))).toBe(true);

    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByRole("button", { name: "Cerrar cámara" })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.locator('div[role="alert"]').filter({ hasText: "conexión" })).toBeVisible();
    await expect(page.getByText("Dispositivo sin autorización")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as CameraTestWindow).__qr006Tracks?.every((track) => track.readyState === "ended"))).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText("Dispositivo autorizado")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByRole("button", { name: "Abriendo cámara…" })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (window as CameraTestWindow).__qr006CameraCalls)).toBe(5);

    const revocation = await adminPage.evaluate(async ({ companyId: selectedCompanyId, label }) => {
      const listResponse = await fetch(`/api/supervisor-devices?companyId=${selectedCompanyId}`, { cache: "no-store" });
      const listed = await listResponse.json() as { devices?: { id: string; label: string; active: boolean }[] };
      const device = (listed.devices ?? []).find((item) => item.label === label && item.active);
      if (!listResponse.ok || !device) return { listStatus: listResponse.status, revokeStatus: null };
      const revokeResponse = await fetch(`/api/supervisor-devices/${device.id}?companyId=${selectedCompanyId}`, { method: "DELETE" });
      return { listStatus: listResponse.status, revokeStatus: revokeResponse.status };
    }, { companyId, label: deviceLabel });
    expect(revocation).toEqual({ listStatus: 200, revokeStatus: 200 });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("Dispositivo sin autorización")).toBeVisible();
    await page.evaluate(() => (window as CameraTestWindow).__qr006ReleaseRevokedCamera?.());
    await expect.poll(() => page.evaluate(() => (window as CameraTestWindow).__qr006Tracks?.length)).toBeGreaterThanOrEqual(3);
    await expect.poll(() => page.evaluate(() => (window as CameraTestWindow).__qr006Tracks?.every((track) => track.readyState === "ended"))).toBe(true);

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

test("cambiar de empresa desmonta el escáner y libera la cámara", async ({ page, browser, qr }) => {
  await page.addInitScript(() => {
    const testWindow = window as CameraTestWindow;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await original(...args);
      testWindow.__qr006Tracks = [...(testWindow.__qr006Tracks ?? []), ...stream.getTracks()];
      return stream;
    };
  });
  const scanRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/attendance/scan") scanRequests.push(request.url());
  });

  await qr.signIn(page, qr.fixture("MULTI_SUPERVISOR_EMAIL"), qr.fixture("MULTI_SUPERVISOR_PASSWORD"));
  await expect(page).toHaveURL(/\/seleccionar-empresa(?:\?|$)/);
  await page.getByRole("button", { name: new RegExp(`${qr.fixture("COMPANY_A_NAME")}.*Continuar`) }).click();
  await expect(page.getByText("Dispositivo sin autorización")).toBeVisible();
  const deviceLabel = `QR006 company switch ${Date.now()}`;
  await page.getByLabel("Nombre del dispositivo").fill(deviceLabel);
  await page.getByRole("button", { name: "Solicitar autorización" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitud enviada");

  const adminContext = await browser.newContext();
  await qr.guardBrowserOrigins(adminContext);
  const adminPage = await adminContext.newPage();
  try {
    await qr.signIn(adminPage, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
    await expect(adminPage).toHaveURL(/\/admin(?:\?|$)/);
    const approval = await adminPage.evaluate(async ({ companyId, label }) => {
      const list = await fetch(`/api/supervisor-devices?companyId=${companyId}`, { cache: "no-store" });
      const body = await list.json() as { requests?: { id: string; label: string; status: string }[] };
      const request = body.requests?.find((item) => item.label === label && item.status === "pending");
      if (!list.ok || !request) return { listStatus: list.status, reviewStatus: null };
      const review = await fetch(`/api/supervisor-devices?companyId=${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.id, approve: true }),
      });
      return { listStatus: list.status, reviewStatus: review.status };
    }, { companyId: qr.fixture("COMPANY_A_ID"), label: deviceLabel });
    expect(approval).toEqual({ listStatus: 200, reviewStatus: 200 });

    await page.reload();
    await expect(page.getByText("Dispositivo autorizado")).toBeVisible();
    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByRole("button", { name: "Cerrar cámara" })).toBeVisible();
    await page.getByRole("link", { name: "Cambiar empresa o rol" }).click();
    await expect(page.getByRole("heading", { name: "Elige empresa y rol" })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`${qr.fixture("COMPANY_B_NAME")}.*Continuar`) }).click();
    await expect(page).toHaveURL(/\/scanner(?:\?|$)/);
    await expect(page.getByText("Dispositivo sin autorización")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as CameraTestWindow).__qr006Tracks?.every((track) => track.readyState === "ended"))).toBe(true);
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
