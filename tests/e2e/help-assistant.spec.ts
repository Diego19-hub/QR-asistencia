import { expect, test } from "./fixtures/qr005-test";

test("Ayuda solo abre el chat y Reportar un problema abre y envía el formulario directamente", async ({ page }) => {
  await page.route("**/api/help/answer", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ found: true, answer: "Según el manual:\n\nSección: Inicio de sesión\nAbre /login e inicia sesión." }),
  }));

  await page.goto("/login");
  const helpButton = page.getByRole("button", { name: "Ayuda" });
  const reportButton = page.getByRole("button", { name: "Reportar un problema" });
  await expect(helpButton).toBeVisible();
  await expect(reportButton).toBeVisible();

  await helpButton.click();
  const chat = page.getByRole("dialog", { name: "Ayuda de QR-asistencia" });
  await expect(chat).toBeVisible();
  await expect(chat.getByLabel("Pregunta")).toBeVisible();
  await expect(page.getByLabel("Descripción")).toHaveCount(0);
  await chat.getByLabel("Pregunta").fill("¿Cómo inicio sesión?");
  await chat.getByRole("button", { name: "Enviar pregunta" }).click();
  await expect(chat.getByText(/Según el manual/)).toBeVisible();
  await expect(chat.getByRole("button", { name: "Reportar un problema" })).toHaveCount(0);

  await helpButton.click();
  await expect(chat).toHaveCount(0);
  await reportButton.click();
  const reportDialog = page.getByRole("dialog", { name: "Reportar un problema" });
  await expect(reportDialog).toBeVisible();
  await expect(reportDialog.getByLabel("Descripción")).toBeVisible();
  await expect(page.getByLabel("Pregunta")).toHaveCount(0);

  let received: unknown;
  await page.route("**/api/help/report", async (route) => {
    received = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Reporte enviado." }) });
  });
  await reportDialog.getByLabel("Descripción").fill("La configuración no carga al abrir la página.");
  await reportDialog.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(reportDialog.getByRole("status")).toHaveText("Reporte enviado.");
  expect(received).toEqual({ description: "La configuración no carga al abrir la página.", page: "/login", website: "" });

  await page.setViewportSize({ width: 360, height: 740 });
  await expect(helpButton).toBeVisible();
  await expect(reportButton).toBeVisible();
  const mobilePanel = await reportDialog.boundingBox();
  expect(mobilePanel).not.toBeNull();
  expect(mobilePanel!.x).toBeGreaterThanOrEqual(0);
  expect(mobilePanel!.y).toBeGreaterThanOrEqual(0);
  expect(mobilePanel!.x + mobilePanel!.width).toBeLessThanOrEqual(360);
  expect(mobilePanel!.y + mobilePanel!.height).toBeLessThanOrEqual(740);
});

test("el reporte muestra un error recuperable sin abrir el chat", async ({ page }) => {
  await page.route("**/api/help/report", async (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "El canal de reportes no está disponible." }),
  }));

  await page.goto("/login");
  await page.getByRole("button", { name: "Reportar un problema" }).click();
  const reportDialog = page.getByRole("dialog", { name: "Reportar un problema" });
  await reportDialog.getByLabel("Descripción").fill("La pantalla muestra un error al cargar.");
  await reportDialog.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(reportDialog.getByRole("alert")).toHaveText("El canal de reportes no está disponible.");
  await expect(page.getByRole("dialog", { name: "Ayuda de QR-asistencia" })).toHaveCount(0);
});
