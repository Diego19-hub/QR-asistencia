import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "./fixtures/qr005-test";

type MailpitMessage = {
  ID?: string;
  id?: string;
  To?: { Address?: string; address?: string }[];
  to?: { Address?: string; address?: string }[];
};

async function invitationConfirmationUrl(mailpitUrl: URL, email: string, appOrigin: string) {
  const listResponse = await fetch(new URL("/api/v1/messages?limit=100", mailpitUrl));
  expect(listResponse.status).toBe(200);
  const payload = await listResponse.json() as { messages?: MailpitMessage[] } | MailpitMessage[];
  const messages = Array.isArray(payload) ? payload : payload.messages ?? [];
  const matching = messages.filter((message) => (message.To ?? message.to ?? [])
    .some((recipient) => (recipient.Address ?? recipient.address ?? "").toLowerCase() === email.toLowerCase()));
  expect(matching).toHaveLength(1);
  const messageId = matching[0].ID ?? matching[0].id;
  expect(typeof messageId).toBe("string");

  const detailResponse = await fetch(new URL("/api/v1/message/" + encodeURIComponent(messageId!), mailpitUrl));
  expect(detailResponse.status).toBe(200);
  const detail = await detailResponse.json() as Record<string, unknown>;
  const body = [detail.HTML, detail.Text, detail.html, detail.text].flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string").join("\n");
  const rawHref = /href\s*=\s*["']([^"'<>]*\/auth\/confirm\?[^"'<>]+)["']/i.exec(body)?.[1];
  expect(typeof rawHref).toBe("string");
  const url = new URL(rawHref!.replaceAll("&amp;", "&"));
  expect(url.origin).toBe(appOrigin);
  expect(url.pathname).toBe("/auth/confirm");
  expect(url.searchParams.get("type")).toBe("invite");
  expect(url.searchParams.get("token_hash")).toBeTruthy();
  return url.toString();
}

async function blockAttendanceScan(context: BrowserContext, attempts: string[]) {
  await context.route("**/api/attendance/scan**", async (route) => {
    attempts.push("/api/attendance/scan");
    await route.abort("blockedbyclient");
  });
}

test("invitación de supervisor, sucursal y dispositivo completan su ciclo sin registrar asistencia", async ({ browser, qr }) => {
  const blockedEndpoints: string[] = [];

  const adminContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const otherSupervisorContext = await browser.newContext();
  await inviteeContext.addInitScript(() => {
    const target = window as Window & { __qr7Tracks?: MediaStreamTrack[] };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await original(...args);
      target.__qr7Tracks = [...(target.__qr7Tracks ?? []), ...stream.getTracks()];
      return stream;
    };
  });
  await qr.guardBrowserOrigins(adminContext);
  await qr.guardBrowserOrigins(inviteeContext);
  await qr.guardBrowserOrigins(otherSupervisorContext);
  await blockAttendanceScan(adminContext, blockedEndpoints);
  await blockAttendanceScan(inviteeContext, blockedEndpoints);
  await blockAttendanceScan(otherSupervisorContext, blockedEndpoints);
  const adminPage = await adminContext.newPage();
  const inviteePage = await inviteeContext.newPage();
  const otherSupervisorPage = await otherSupervisorContext.newPage();
  try {
    await qr.signIn(adminPage, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
    await expect(adminPage).toHaveURL(/\/admin(?:\?|$)/);
    const email = "supervisor-" + randomUUID() + "@qr-asistencia.invalid";
    await adminPage.goto("/admin/configuracion#avanzada");
    await expect(adminPage.locator("#usuarios-accesos").getByRole("heading", { name: "Usuarios y accesos" })).toBeVisible();
    const inviteForm = adminPage.getByLabel("Correo de trabajo").locator("xpath=ancestor::form");
    await inviteForm.getByLabel("Correo de trabajo").fill(email);
    await inviteForm.getByLabel("Acceso").selectOption("supervisor");
    await inviteForm.getByRole("button", { name: "Enviar invitación" }).click();
    await expect(adminPage.getByRole("status")).toContainText("Enviamos la invitación de Supabase Auth. La persona debe abrir el enlace, completar su cuenta y después aceptar la invitación.");

    const confirmationUrl = await invitationConfirmationUrl(qr.mailpitUrl, email, qr.baseUrl.origin);
    await inviteePage.goto(confirmationUrl);
    await expect(inviteePage.getByRole("button", { name: "Confirmar invitación" })).toBeVisible();
    await inviteePage.getByRole("button", { name: "Confirmar invitación" }).click();
    await expect(inviteePage.getByRole("heading", { name: "Completar cuenta y aceptar invitación" })).toBeVisible();
    await expect(inviteePage.getByText("Correo confirmado por Supabase Auth")).toBeVisible();
    const password = "Qr7-" + randomUUID() + "-Aa9";
    await inviteePage.getByLabel("Nombre completo").fill("Supervisora Sintética QR");
    await inviteePage.getByLabel("Contraseña", { exact: true }).fill(password);
    await inviteePage.getByLabel("Confirmar contraseña", { exact: true }).fill(password);
    await inviteePage.getByRole("button", { name: "Guardar datos y continuar" }).click();
    await expect(inviteePage.getByRole("status")).toContainText("Cuenta configurada. Ahora acepta la invitación para activar el acceso a la empresa.");
    await inviteePage.getByRole("button", { name: "Aceptar invitación" }).click();
    await expect(inviteePage.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible();

    const acceptedMembership = await inviteePage.evaluate(async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      const body = await response.json();
      return { status: response.status, roles: (body.memberships ?? []).map((membership: { role: string }) => membership.role) };
    });
    expect(acceptedMembership.status).toBe(200);
    expect(acceptedMembership.roles).toEqual(["supervisor"]);

    await adminPage.goto("/admin/supervisores");
    await expect(adminPage.getByRole("heading", { name: "Supervisores y dispositivos" })).toBeVisible();
    const companyId = qr.fixture("COMPANY_A_ID");
    const supervisorsResponse = await adminContext.request.get(new URL(`/api/supervisors?companyId=${companyId}`, qr.baseUrl).href);
    const assignmentPayload = await supervisorsResponse.json();
    const assignmentData = assignmentPayload.data ?? {};
    const assignmentSupervisor = (assignmentData.supervisors ?? []).find((item: { email: string }) => item.email.toLowerCase() === email.toLowerCase());
    expect(supervisorsResponse.status()).toBe(200);
    expect(assignmentData.branches?.[0]).toBeTruthy();
    expect(assignmentSupervisor).toMatchObject({ branches: [] });
    const branch = assignmentData.branches[0];
    const membershipId = assignmentSupervisor.membershipId;
    const supervisorRow = adminPage.getByText(email, { exact: true }).locator("xpath=..");
    await expect(supervisorRow).toBeVisible();

    const deniedByRole = await inviteePage.evaluate(async ({ companyId, membershipId, branchId }) => {
      const response = await fetch("/api/supervisors?companyId=" + companyId, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId, branchId, assigned: true }),
      });
      return response.status;
    }, { companyId: qr.fixture("COMPANY_A_ID"), membershipId, branchId: branch.id });
    expect(deniedByRole).toBe(403);

    const readAssignment = async () => {
      const response = await adminContext.request.get(new URL(`/api/supervisors?companyId=${companyId}`, qr.baseUrl).href);
      const body = await response.json();
      const supervisor = (body.data?.supervisors ?? []).find((item: { email: string }) => item.email.toLowerCase() === email.toLowerCase());
      return { status: response.status(), branches: supervisor?.branches ?? null };
    };
    const beforeForeignBranch = await readAssignment();
    const foreignBranchResponse = await adminContext.request.patch(new URL(`/api/supervisors?companyId=${companyId}`, qr.baseUrl).href, {
      data: { membershipId, branchId: qr.fixture("BRANCH_B_ID"), assigned: true },
      headers: { "Content-Type": "application/json" },
    });
    const afterForeignBranch = await readAssignment();
    expect(foreignBranchResponse.status()).toBe(409);
    expect(afterForeignBranch.branches).toEqual(beforeForeignBranch.branches);
    expect(afterForeignBranch.branches).toEqual([]);

    const branchCheckbox = supervisorRow.getByRole("checkbox", { name: branch.name });
    const branchAssignmentResponse = adminPage.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/supervisors" && response.request().method() === "PATCH");
    await branchCheckbox.click();
    const assignmentResponse = await branchAssignmentResponse;
    expect(assignmentResponse.status()).toBe(200);
    await expect(adminPage.getByRole("status")).toContainText("Los cambios se guardaron correctamente.");
    await expect(branchCheckbox).toBeChecked();
    await adminPage.reload();
    const assignedRow = adminPage.getByText(email, { exact: true }).locator("xpath=..");
    await expect(assignedRow.getByRole("checkbox", { name: branch.name })).toBeChecked();

    const scannerContextAfterAssignment = await inviteePage.evaluate(async (companyId) => {
      const response = await fetch("/api/supervisor/scanner/context?companyId=" + companyId, { cache: "no-store" });
      const body = await response.json();
      return { status: response.status, context: body.contexts?.[0] ?? null };
    }, qr.fixture("COMPANY_A_ID"));
    expect(scannerContextAfterAssignment.status).toBe(200);
    expect(scannerContextAfterAssignment.context).toMatchObject({
      companyId: qr.fixture("COMPANY_A_ID"),
      authorized: false,
      branchId: null,
      branchName: null,
      branches: [{ id: branch.id, name: branch.name }],
    });

    await inviteePage.reload();
    await expect(inviteePage.getByText("Dispositivo sin autorización")).toBeVisible();
    await expect(inviteePage.getByLabel("Sucursal")).toHaveValue(branch.id);
    const deviceLabel = "QR fase 7 synthetic supervisor device";
    await inviteePage.getByLabel("Nombre del dispositivo").fill(deviceLabel);
    await inviteePage.getByRole("button", { name: "Solicitar autorización" }).click();
    await expect(inviteePage.getByRole("status")).toContainText("Solicitud enviada");
    const requestState = await adminPage.evaluate(async ({ companyId, label }) => {
      const response = await fetch("/api/supervisor-devices?companyId=" + companyId, { cache: "no-store" });
      const body = await response.json();
      const request = (body.requests ?? []).find((item: { label: string }) => item.label === label);
      return { status: response.status, request: request ? { id: request.id, status: request.status } : null };
    }, { companyId: qr.fixture("COMPANY_A_ID"), label: deviceLabel });
    expect(requestState).toMatchObject({ status: 200, request: { status: "pending" } });
    const requestId = requestState.request!.id;

    const adminBContext = await browser.newContext();
    await qr.guardBrowserOrigins(adminBContext);
    await blockAttendanceScan(adminBContext, blockedEndpoints);
    const adminBPage = await adminBContext.newPage();
    try {
      await qr.signIn(adminBPage, qr.fixture("ADMIN_B_EMAIL"), qr.fixture("ADMIN_B_PASSWORD"));
      await expect(adminBPage).toHaveURL(/\/admin(?:\?|$)/);
      const crossCompanyReview = await adminBPage.evaluate(async ({ companyId, requestId }) => {
        const response = await fetch("/api/supervisor-devices?companyId=" + companyId, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, approve: true }),
        });
        return response.status;
      }, { companyId: qr.fixture("COMPANY_B_ID"), requestId });
      expect(crossCompanyReview).toBe(409);
      const afterCrossCompanyReview = await adminContext.request.get(new URL(`/api/supervisor-devices?companyId=${companyId}`, qr.baseUrl).href);
      const afterCrossCompanyPayload = await afterCrossCompanyReview.json();
      expect(afterCrossCompanyReview.status()).toBe(200);
      expect(afterCrossCompanyPayload.requests).toContainEqual(expect.objectContaining({ id: requestId, status: "pending" }));
      expect(afterCrossCompanyPayload.devices).not.toContainEqual(expect.objectContaining({ label: deviceLabel, active: true }));
    } finally {
      await adminBContext.close();
    }

    await adminPage.reload();
    await expect(adminPage.getByText(deviceLabel, { exact: false })).toBeVisible();
    await adminPage.getByRole("button", { name: "Aprobar" }).click();
    await expect(adminPage.getByRole("status")).toContainText("Los cambios se guardaron correctamente.");
    await inviteePage.reload();
    await expect(inviteePage.getByText("Dispositivo autorizado")).toBeVisible();
    const authorizedContext = await inviteePage.evaluate(async (companyId) => {
      const response = await fetch("/api/supervisor/scanner/context?companyId=" + companyId, { cache: "no-store" });
      const body = await response.json();
      return { status: response.status, context: body.contexts?.[0] ?? null };
    }, qr.fixture("COMPANY_A_ID"));
    expect(authorizedContext.status).toBe(200);
    expect(authorizedContext.context).toMatchObject({ companyId: qr.fixture("COMPANY_A_ID"), authorized: true, branchId: branch.id });
    expect(authorizedContext.context.deviceId).toBeTruthy();

    await qr.signIn(otherSupervisorPage, qr.fixture("NETWORK_SUPERVISOR_EMAIL"), qr.fixture("NETWORK_SUPERVISOR_PASSWORD"));
    await expect(otherSupervisorPage.getByText("Dispositivo sin autorización")).toBeVisible();

    await inviteePage.getByRole("button", { name: "Abrir cámara" }).click();
    await expect(inviteePage.getByRole("button", { name: "Cerrar cámara" })).toBeVisible();
    adminPage.once("dialog", (dialog) => void dialog.accept());
    const revokeResponsePromise = adminPage.waitForResponse((response) =>
      new URL(response.url()).pathname.startsWith("/api/supervisor-devices/") && response.request().method() === "DELETE");
    await adminPage.getByRole("button", { name: "Revocar " + deviceLabel }).click();
    const revokeResponse = await revokeResponsePromise;
    expect(revokeResponse.status()).toBe(200);
    await expect(adminPage.getByRole("status")).toContainText("Los cambios se guardaron correctamente.");
    const revokedDeviceState = await adminContext.request.get(new URL(`/api/supervisor-devices?companyId=${companyId}`, qr.baseUrl).href);
    const revokedDevicePayload = await revokedDeviceState.json();
    expect(revokedDeviceState.status()).toBe(200);
    expect(revokedDevicePayload.devices).toContainEqual(expect.objectContaining({ label: deviceLabel, active: false }));
    const contextAfterRevocation = await inviteePage.evaluate(async () => {
      const response = await fetch("/api/supervisor/scanner/context", { method: "POST", cache: "no-store" });
      const body = await response.json();
      return { status: response.status, authorized: body.contexts?.[0]?.authorized ?? null };
    });
    expect(contextAfterRevocation).toEqual({ status: 200, authorized: false });
    await inviteePage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(inviteePage.getByText("Dispositivo sin autorización")).toBeVisible();
    await expect.poll(() => inviteePage.evaluate(() => (window as Window & { __qr7Tracks?: MediaStreamTrack[] }).__qr7Tracks?.every((track) => track.readyState === "ended"))).toBe(true);
    expect(contextAfterRevocation.authorized).toBe(false);
    expect(blockedEndpoints, `Se intentó llamar al endpoint bloqueado: ${blockedEndpoints.join(", ")}`).toEqual([]);
  } finally {
    await adminContext.close();
    await inviteeContext.close();
    await otherSupervisorContext.close();
  }
});
