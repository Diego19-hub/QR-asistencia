import { expect, test } from "@playwright/test";

const baseUrl = new URL(process.env.QR005_BASE_URL);
const supabaseUrl = new URL(process.env.QR005_SUPABASE_URL);
const allowedOrigins = new Set([baseUrl.origin, supabaseUrl.origin]);

function assertLoopbackUrl(value, label) {
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(parsed.hostname)) {
    throw new Error(`${label} must use loopback in the QR-005 E2E suite`);
  }
  if (["llxyziffgtqnzlguxhyt", "jawdrhewabqajxnswhkn"].some((ref) => value.includes(ref))) {
    throw new Error(`${label} must not reference a hosted Supabase project`);
  }
}

assertLoopbackUrl(baseUrl.href, "Next.js URL");
assertLoopbackUrl(supabaseUrl.href, "Supabase URL");

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return allowedOrigins.has(origin) ? route.continue() : route.abort("blockedbyclient");
  });
});

async function signIn(page, email, password) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

function fixture(name) {
  const value = process.env[`QR005_${name}`];
  if (!value) throw new Error(`Missing synthetic QR-005 fixture: ${name}`);
  return value;
}

test("rutas protegidas redirigen a login sin sesión", async ({ page }) => {
  for (const path of ["/admin", "/scanner", "/mi-qr"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  }
});

test("login administrativo real, error de contraseña y cierre de sesión", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(fixture("ADMIN_EMAIL"));
  await page.getByLabel("Contraseña").fill("incorrect-synthetic-password-only");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("No se pudo iniciar sesión.", { exact: false })).toBeVisible();
  expect((await page.context().cookies(baseUrl.href)).some((cookie) => cookie.name.startsWith("sb-"))).toBe(false);

  await signIn(page, fixture("ADMIN_EMAIL"), fixture("ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("link", { name: "Empleados", exact: true })).toBeVisible();
  const membershipCookie = (await page.context().cookies(baseUrl.href)).find((cookie) => cookie.name === "qr_active_membership_id");
  expect(membershipCookie?.httpOnly).toBe(true);
  await page.getByRole("button", { name: "Cerrar sesión" }).evaluate((button) => button.form?.requestSubmit(button));
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("supervisor autorizado abre el escáner y un rol insuficiente no entra a administración", async ({ page }) => {
  await signIn(page, fixture("SUPERVISOR_EMAIL"), fixture("SUPERVISOR_PASSWORD"));
  await expect(page).toHaveURL(/\/scanner(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
  await expect(page.getByText("Dispositivo sin autorización")).toBeVisible();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?error=no-company/);
  await expect(page.getByText("Tu cuenta aún no está asignada a una empresa.", { exact: false })).toBeVisible();
});

test("empleado ve únicamente su portal vinculado y no accede a administración", async ({ page }) => {
  await signIn(page, fixture("EMPLOYEE_EMAIL"), fixture("EMPLOYEE_PASSWORD"));
  await expect(page).toHaveURL(/\/mi-qr(?:\?|$)/);
  await expect(page.getByRole("heading", { name: /Hola,/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mi credencial" })).toHaveCount(0);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?error=no-company/);
});

test("empleado sin expediente vinculado no recibe datos de otras personas", async ({ page }) => {
  await signIn(page, fixture("UNLINKED_EMPLOYEE_EMAIL"), fixture("UNLINKED_EMPLOYEE_PASSWORD"));
  await expect(page).toHaveURL(/\/mi-qr(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Perfil de empleado no vinculado" })).toBeVisible();
  await expect(page.getByText(/No se mostraron datos de otras personas/)).toBeVisible();
});

test("cuentas sin membresía activa no alcanzan rutas protegidas", async ({ page }) => {
  for (const key of ["NO_MEMBERSHIP", "INACTIVE_MEMBERSHIP"]) {
    await signIn(page, fixture(`${key}_EMAIL`), fixture(`${key}_PASSWORD`));
    await expect(page).toHaveURL(/\/login\?error=no-company/);
    await expect(page.getByText("Tu cuenta aún no está asignada a una empresa.", { exact: false })).toBeVisible();
  }
});

test("una membresía revocada deja de autorizar la ruta del escáner", async ({ page, browser }) => {
  await signIn(page, fixture("REVOKED_SUPERVISOR_EMAIL"), fixture("REVOKED_SUPERVISOR_PASSWORD"));
  if (new URL(page.url()).pathname === "/scanner") {
    await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
    const adminContext = await browser.newContext();
    await adminContext.route("**/*", (route) => {
      const origin = new URL(route.request().url()).origin;
      return allowedOrigins.has(origin) ? route.continue() : route.abort("blockedbyclient");
    });
    const adminPage = await adminContext.newPage();
    try {
      await signIn(adminPage, fixture("ADMIN_EMAIL"), fixture("ADMIN_PASSWORD"));
      const companyId = fixture("COMPANY_A_ID");
      const membershipId = fixture("REVOKED_SUPERVISOR_MEMBERSHIP_ID");
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

test("selección explícita permite cambiar entre las empresas propias", async ({ page }) => {
  await signIn(page, fixture("MULTI_ADMIN_EMAIL"), fixture("MULTI_ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/seleccionar-empresa(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Elige empresa y rol" })).toBeVisible();
  const companyA = fixture("COMPANY_A_NAME");
  const companyB = fixture("COMPANY_B_NAME");
  const options = page.getByRole("button", { name: /Continuar/ });
  await expect(options).toHaveCount(2);

  await page.getByRole("button", { name: new RegExp(`${companyB}.*Continuar`) }).click();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("combobox", { name: "Empresa activa" })).toHaveValue(fixture("COMPANY_B_ID"));
  await page.goto("/seleccionar-empresa");
  await page.getByRole("button", { name: new RegExp(`${companyA}.*Continuar`) }).click();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  await expect(page.getByRole("combobox", { name: "Empresa activa" })).toHaveValue(fixture("COMPANY_A_ID"));
  const cookie = (await page.context().cookies(baseUrl.href)).find((item) => item.name === "qr_active_membership_id");
  expect(cookie?.httpOnly).toBe(true);
});

test("dispositivo local se solicita, aprueba y revoca sin registrar asistencia", async ({ page, browser }) => {
  const scanRequests = [];
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let firstCall = true;
    navigator.mediaDevices.getUserMedia = async (...args) => {
      if (firstCall) {
        firstCall = false;
        throw new DOMException("Synthetic camera permission denial", "NotAllowedError");
      }
      return original(...args);
    };
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/attendance/scan") scanRequests.push(request.url());
  });
  await signIn(page, fixture("SUPERVISOR_EMAIL"), fixture("SUPERVISOR_PASSWORD"));
  await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();
  const deviceLabel = `QR005 fake camera ${Date.now()}`;
  await page.getByLabel("Nombre del dispositivo").fill(deviceLabel);
  await page.getByRole("button", { name: "Solicitar autorización" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitud enviada");

  const adminContext = await browser.newContext();
  await adminContext.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return allowedOrigins.has(origin) ? route.continue() : route.abort("blockedbyclient");
  });
  const adminPage = await adminContext.newPage();
  try {
    await signIn(adminPage, fixture("ADMIN_EMAIL"), fixture("ADMIN_PASSWORD"));
    await expect(adminPage).toHaveURL(/\/admin(?:\?|$)/);
    const companyId = fixture("COMPANY_A_ID");
    const approval = await adminPage.evaluate(async ({ companyId: selectedCompanyId, label }) => {
      const listResponse = await fetch(`/api/supervisor-devices?companyId=${selectedCompanyId}`, { cache: "no-store" });
      const listed = await listResponse.json();
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
    await expect(page.getByText("Dispositivo autorizado")).toBeVisible();
    await expect(page.getByText(/Escanear no registra la asistencia/)).toBeVisible();

    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByText("No se pudo abrir la cámara.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(page.getByRole("button", { name: "Cerrar cámara" })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar cámara" }).click();

    const revocation = await adminPage.evaluate(async ({ companyId: selectedCompanyId, label }) => {
      const listResponse = await fetch(`/api/supervisor-devices?companyId=${selectedCompanyId}`, { cache: "no-store" });
      const listed = await listResponse.json();
      const device = (listed.devices ?? []).find((item) => item.label === label && item.active);
      if (!listResponse.ok || !device) return { listStatus: listResponse.status, revokeStatus: null };
      const revokeResponse = await fetch(`/api/supervisor-devices/${device.id}?companyId=${selectedCompanyId}`, { method: "DELETE" });
      return { listStatus: listResponse.status, revokeStatus: revokeResponse.status };
    }, { companyId, label: deviceLabel });
    expect(revocation).toEqual({ listStatus: 200, revokeStatus: 200 });
    await page.reload();
    await expect(page.getByText("Dispositivo sin autorización")).toBeVisible();

    const membershipId = fixture("SUPERVISOR_MEMBERSHIP_ID");
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

test("supervisor sin sucursal conserva la denegación de contexto", async ({ page }) => {
  await signIn(page, fixture("NO_BRANCH_SUPERVISOR_EMAIL"), fixture("NO_BRANCH_SUPERVISOR_PASSWORD"));
  await expect(page).toHaveURL(/\/scanner(?:\?|$)/);
  await expect(page.getByText("Sin sucursal asignada.")).toBeVisible();
});
