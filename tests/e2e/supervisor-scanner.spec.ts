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
      if (cameraFailures === 2) {
        cameraFailures += 1;
        throw new DOMException("Synthetic camera is occupied", "NotReadableError");
      }
      if (cameraFailures === 3) {
        cameraFailures += 1;
        throw new DOMException("Synthetic unsupported camera constraints", "OverconstrainedError");
      }
      if (testWindow.__qr006CameraCalls === 5) {
        await new Promise<void>((resolve) => { testWindow.__qr006ReleaseInitialCamera = resolve; });
      }
      if (testWindow.__qr006CameraCalls === 7) {
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
    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByText("La cámara está ocupada", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByText("no admite la configuración solicitada", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Abrir cámara" }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => page.evaluate(() => (window as CameraTestWindow).__qr006CameraCalls)).toBe(5);
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
    await expect.poll(() => page.evaluate(() => (window as CameraTestWindow).__qr006CameraCalls)).toBe(7);

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

test("una solicitud de dispositivo rechazada se explica y permite corregirla", async ({ page, browser, qr }) => {
  await qr.signIn(page, qr.fixture("NETWORK_SUPERVISOR_EMAIL"), qr.fixture("NETWORK_SUPERVISOR_PASSWORD"));
  await expect(page.getByText("Dispositivo sin autorización")).toBeVisible();
  const label = `QR006 rejected device ${Date.now()}`;
  await page.getByLabel("Nombre del dispositivo").fill(label);
  await page.getByRole("button", { name: "Solicitar autorización" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitud enviada");

  const adminContext = await browser.newContext();
  await qr.guardBrowserOrigins(adminContext);
  const adminPage = await adminContext.newPage();
  try {
    await qr.signIn(adminPage, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
    await expect(adminPage).toHaveURL(/\/admin(?:\?|$)/);
    const result = await adminPage.evaluate(async ({ companyId, deviceLabel }) => {
      const response = await fetch(`/api/supervisor-devices?companyId=${companyId}`, { cache: "no-store" });
      const body = await response.json() as { requests?: { id: string; label: string; status: string }[] };
      const request = body.requests?.find((item) => item.label === deviceLabel && item.status === "pending");
      if (!response.ok || !request) return { listStatus: response.status, reviewStatus: null };
      const reviewed = await fetch(`/api/supervisor-devices?companyId=${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.id, approve: false }),
      });
      return { listStatus: response.status, reviewStatus: reviewed.status };
    }, { companyId: qr.fixture("COMPANY_A_ID"), deviceLabel: label });
    expect(result).toEqual({ listStatus: 200, reviewStatus: 200 });
    await page.reload();
    await expect(page.getByRole("status")).toContainText("La solicitud anterior fue rechazada.");
    await expect(page.getByRole("button", { name: "Solicitar autorización" })).toBeVisible();
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
  await expect(page.locator('div[role="alert"]').filter({ hasText: "No fue posible validar el dispositivo" })).toBeVisible();
  await expect(page.getByText("Dispositivo sin autorización")).toBeVisible({ timeout: 20_000 });
  expect(contextRequests).toBeGreaterThanOrEqual(2);
  expect(attendanceRequests).toHaveLength(0);
});

test("contexto HTTP diferencia sesión expirada y error temporal sin exponer detalles", async ({ page, qr }) => {
  let contextRequests = 0;
  const failures = [
    { status: 401, code: "auth_required", message: "Tu sesión expiró" },
    { status: 403, code: "supervisor_forbidden", message: "El acceso del dispositivo o de la membresía fue revocado" },
    { status: 409, code: "company_selection_required", message: "Selecciona una empresa" },
    { status: 429, code: "rate_limited", message: "Hay demasiadas comprobaciones" },
    { status: 500, code: "scanner_context_failed", message: "temporalmente indisponible" },
    { status: 503, code: "scanner_context_failed", message: "temporalmente indisponible" },
  ];
  await page.route("**/api/supervisor/scanner/context", async (route) => {
    contextRequests += 1;
    const failure = failures[contextRequests - 1];
    if (!failure) return route.continue();
    await route.fulfill({
      status: failure.status,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: failure.code, message: "internal server detail" } }),
    });
  });
  await qr.signIn(page, qr.fixture("NETWORK_SUPERVISOR_EMAIL"), qr.fixture("NETWORK_SUPERVISOR_PASSWORD"));
  await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
  for (const [index, failure] of failures.entries()) {
    if (index > 0) await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator('div[role="alert"]').filter({ hasText: failure.message })).toBeVisible();
    await expect(page.getByText("internal server detail")).toHaveCount(0);
  }
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Dispositivo sin autorización")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('div[role="alert"]').filter({ hasText: /temporalmente indisponible|Tu sesión expiró|comprobaciones|selecciona una empresa|revocado/ })).toHaveCount(0);
  expect(contextRequests).toBe(failures.length + 1);
});

test("vista del escáner no desborda horizontalmente en tamaños móviles y tablet", async ({ page, qr }) => {
  await qr.signIn(page, qr.fixture("NETWORK_SUPERVISOR_EMAIL"), qr.fixture("NETWORK_SUPERVISOR_PASSWORD"));
  await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
  for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
  }
});

test("una respuesta antigua del contexto no reemplaza la comprobación vigente", async ({ page, qr }) => {
  let requests = 0;
  let signalFirstResponse!: () => void;
  let releaseFirstResponse!: () => void;
  const firstStarted = new Promise<void>((resolve) => { signalFirstResponse = resolve; });
  const firstRelease = new Promise<void>((resolve) => { releaseFirstResponse = resolve; });
  await page.route("**/api/supervisor/scanner/context", async (route) => {
    requests += 1;
    if (requests !== 1) return route.continue();
    const response = await route.fetch();
    const body = await response.json() as { contexts: { companyName: string }[] };
    signalFirstResponse();
    await firstRelease;
    if (body.contexts[0]) body.contexts[0].companyName = "Contexto obsoleto de prueba";
    try {
      await route.fulfill({ response, json: body });
    } catch {
      // A later request may abort this in-flight response as designed.
    }
  });
  await qr.signIn(page, qr.fixture("NETWORK_SUPERVISOR_EMAIL"), qr.fixture("NETWORK_SUPERVISOR_PASSWORD"));
  await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
  await firstStarted;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText(qr.fixture("COMPANY_A_NAME"), { exact: false })).toBeVisible({ timeout: 20_000 });
  releaseFirstResponse();
  await expect(page.getByText("Contexto obsoleto de prueba")).toHaveCount(0);
  expect(requests).toBeGreaterThanOrEqual(2);
});

test("cambiar de empresa desmonta una petición pendiente y descarta su respuesta anterior", async ({ page, qr }) => {
  let firstStarted!: () => void;
  let releaseFirst!: () => void;
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let requests = 0;
  await page.route("**/api/supervisor/scanner/context", async (route) => {
    requests += 1;
    if (requests !== 1) return route.continue();
    const response = await route.fetch();
    const body = await response.json() as { contexts: { companyName: string }[] };
    firstStarted();
    await release;
    if (body.contexts[0]) body.contexts[0].companyName = "Respuesta antigua de empresa A";
    try {
      await route.fulfill({ response, json: body });
    } catch {
      // La navegación puede haber cancelado la petición del componente desmontado.
    }
  });
  await qr.signIn(page, qr.fixture("MULTI_SUPERVISOR_EMAIL"), qr.fixture("MULTI_SUPERVISOR_PASSWORD"));
  await expect(page).toHaveURL(/\/seleccionar-empresa(?:\?|$)/);
  await page.getByRole("button", { name: new RegExp(`${qr.fixture("COMPANY_A_NAME")}.*Continuar`) }).click();
  await started;
  await page.getByRole("link", { name: "Cambiar empresa o rol" }).click();
  await expect(page.getByRole("heading", { name: "Elige empresa y rol" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`${qr.fixture("COMPANY_B_NAME")}.*Continuar`) }).click();
  await expect(page).toHaveURL(/\/scanner(?:\?|$)/);
  await expect(page.getByText(qr.fixture("COMPANY_B_NAME"), { exact: false })).toBeVisible({ timeout: 20_000 });
  releaseFirst();
  await expect(page.getByText("Respuesta antigua de empresa A")).toHaveCount(0);
  expect(requests).toBeGreaterThanOrEqual(2);
});
