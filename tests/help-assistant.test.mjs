import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { readLimitedBody } from "../src/lib/http/read-limited-body.ts";

import {
  allowHelpReport,
  answerFromManual,
  deliverHelpReport,
  reportablePages,
  sanitizeReportDescription,
  sendTelegramReport,
  telegramConfig,
  validateHelpReport,
} from "../src/lib/help/manual-assistant.ts";

const manual = await readFile(new URL("../docs/MANUAL-USUARIO.md", import.meta.url), "utf8");
const widget = await readFile(new URL("../src/components/help/help-assistant.tsx", import.meta.url), "utf8");

test("las respuestas recuperadas provienen del manual y citan su fuente", () => {
  const result = answerFromManual(manual, "¿Cómo activo el requisito del PIN?");
  assert.equal(result.found, true);
  assert.match(result.answer, /Sección: .*Configuración del PIN/);
  assert.match(result.answer, /PIN es opcional y está desactivado por defecto/);
  assert.ok(result.answer.startsWith("Según el manual:"));
});

test("la ayuda reconoce la ausencia de contenido suficiente", () => {
  const result = answerFromManual(manual, "¿Cómo configuro la nómina fiscal externa?");
  assert.equal(result.found, false);
  assert.match(result.answer, /No encontré/);
});

test("el widget declara semántica de diálogo, estado expandido, foco visible y ubicación móvil", () => {
  assert.match(widget, /aria-haspopup="dialog"/);
  assert.match(widget, /aria-controls="help-dialog"/);
  assert.match(widget, /role="dialog"/);
  assert.match(widget, /aria-live="polite"/);
  assert.match(widget, /focus-visible:ring/);
  assert.match(widget, /employeePortal \? "bottom-24 md:bottom-6"/);
  assert.match(widget, /employeePortal\s*\?\s*"bottom-\[11rem\][\s\S]*md:bottom-36/);
});

test("el chat y el reporte son paneles independientes; el chat no contiene el formulario", () => {
  assert.match(widget, /aria-controls="help-dialog"/);
  assert.match(widget, /aria-controls="report-dialog"/);
  assert.match(widget, /<CircleHelp size=\{19\} aria-hidden="true" \/>Ayuda/);
  const chatStart = widget.indexOf("{activePanel === \"chat\" ? <section");
  const reportStart = widget.indexOf("{activePanel === \"report\" ? <section");
  assert.ok(chatStart >= 0 && reportStart > chatStart);
  const chatPanel = widget.slice(chatStart, reportStart);
  const reportPanel = widget.slice(reportStart);
  assert.doesNotMatch(chatPanel, /submitReport|api\/help\/report|Reportar un problema/);
  assert.match(reportPanel, /onSubmit=\{\(event\) => void submitReport\(event\)\}/);
  assert.match(reportPanel, /Enviar reporte/);
});

test("el reporte exige texto suficiente y una página de la aplicación", () => {
  assert.equal(validateHelpReport({ description: "Falla", page: "/login" }).ok, false);
  assert.equal(validateHelpReport({ description: "No carga la página de horarios", page: "https://externo.test" }).ok, false);
  const result = validateHelpReport({ description: "No carga la página de horarios", page: "/admin/horarios", website: "" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.report.page, "/admin/horarios");
  assert.ok(reportablePages.includes("/scanner"));
});

test("redacta correo, teléfono, credenciales, PIN, tokens e identificadores", () => {
  const text = sanitizeReportDescription("Falló usuario.qa@example.test, teléfono +52 555 123 4567, contraseña: Secreto987, PIN: 123456, token=eyJabcdefghijklmnopqrstuvwxyz1234567890ABCDEF y sesión 123e4567-e89b-12d3-a456-426614174000");
  assert.doesNotMatch(text, /usuario\.qa@example\.test|555 123 4567|Secreto987|123456|eyJabcdefghijklmnopqrstuvwxyz|123e4567-e89b/);
  assert.match(text, /correo omitido/);
  assert.match(text, /dato sensible omitido/);
});

test("el honeypot y campos inesperados no son aceptados", () => {
  assert.equal(validateHelpReport({ description: "Un error que se reproduce", page: "/login", website: "spam" }).ok, false);
  assert.equal(validateHelpReport({ description: "Un error que se reproduce", page: "/login", token: "fake" }).ok, false);
});

test("Telegram permanece desactivado mientras falte una variable privada", () => {
  assert.equal(telegramConfig({ TELEGRAM_BOT_TOKEN: "fake-token" } ), null);
  assert.equal(telegramConfig({ TELEGRAM_CHAT_ID: "123" } ), null);
  assert.deepEqual(telegramConfig({ TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_CHAT_ID: "123" }), { token: "test-token", chatId: "123" });
});

test("no hace llamadas de red si falta configuración de Telegram", async () => {
  let calls = 0;
  const result = await deliverHelpReport({ page: "/login", description: "El login falla al cargar." }, { TELEGRAM_BOT_TOKEN: "test-token" }, async () => { calls += 1; throw new Error("no se esperaba red"); });
  assert.equal(result, "not_configured");
  assert.equal(calls, 0);
});

test("envía solo página y descripción por la API oficial con transporte falso", async () => {
  let requestUrl = "";
  let requestBody = "";
  const ok = await sendTelegramReport({ token: "test-token", chatId: "123" }, { page: "/admin", description: "La pantalla no carga." }, async (input, init) => {
    requestUrl = String(input); requestBody = String(init?.body);
    return Response.json({ ok: true, result: {} });
  });
  assert.equal(ok, true);
  assert.match(requestUrl, /^https:\/\/api\.telegram\.org\/bottest-token\/sendMessage$/);
  const payload = JSON.parse(requestBody);
  assert.deepEqual(Object.keys(payload).sort(), ["chat_id", "link_preview_options", "text"]);
  assert.equal(payload.text, "Página: /admin\nDescripción: La pantalla no carga.");
  assert.doesNotMatch(requestBody, /test-token/);
});

test("un error del proveedor se devuelve como fallo sin propagar contenido externo", async () => {
  assert.equal(await sendTelegramReport({ token: "test-token", chatId: "123" }, { page: "/login", description: "Falla reproducible." }, async () => new Response("error", { status: 500 })), false);
});

test("limita a cuatro reportes por clave en una ventana y permite reiniciar después", () => {
  const store = new Map();
  for (let i = 0; i < 4; i += 1) assert.equal(allowHelpReport("hashed-client", 1000 + i, store), true);
  assert.equal(allowHelpReport("hashed-client", 1004, store), false);
  assert.equal(allowHelpReport("hashed-client", 901_005, store), true);
});

test("el lector de solicitudes cancela cuerpos que exceden el límite", async () => {
  const request = new Request("http://localhost", { method: "POST", body: "123456", duplex: "half" });
  await assert.rejects(readLimitedBody(request, 5), RangeError);
});
