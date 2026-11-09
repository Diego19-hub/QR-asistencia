import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { readLimitedBody } from "../src/lib/http/read-limited-body.ts";

import {
  allowHelpReport,
  allowHelpQuestion,
  answerHelpQuestion,
  answerFromManual,
  initialManualSuggestions,
  relatedManualSuggestions,
  deliverHelpReport,
  geminiConfig,
  redactChatQuestion,
  retrieveManualContext,
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
  assert.ok(result.answer.startsWith("Según el manual, sigue estos pasos"));
});

test("la ayuda reconoce la ausencia de contenido suficiente", () => {
  const result = answerFromManual(manual, "¿Cómo configuro la nómina fiscal externa?");
  assert.equal(result.found, false);
  assert.match(result.answer, /No encontré/);
  assert.match(result.answer, /Reportar un problema/);
  assert.match(result.answer, /preguntas relacionadas/);
});

test("las preguntas iniciales se limitan a temas documentados en el manual", () => {
  const suggestions = initialManualSuggestions(manual);
  assert.deepEqual(suggestions, [
    "¿Cómo inicio sesión?",
    "¿Dónde consulto mi horario?",
    "¿Cómo veo mi credencial QR?",
    "¿Cómo registro un movimiento de asistencia?",
    "¿Cómo administro empleados?",
    "¿Cómo cambio de empresa?",
  ]);
  assert.deepEqual(initialManualSuggestions("# Iniciar sesión\n\nEscribe correo y la contraseña."), ["¿Cómo inicio sesión?"]);
  assert.ok(suggestions.every((item) => typeof item === "string" && item.length > 0));
});

test("las preguntas relacionadas usan temas del manual y nunca exceden tres", () => {
  const schedule = relatedManualSuggestions(manual, "¿Cómo consulto mi horario?");
  assert.ok(schedule.length > 0 && schedule.length <= 3);
  assert.ok(schedule.includes("¿Cómo creo y asigno un horario?"));
  const unrelated = relatedManualSuggestions(manual, "¿Cómo configuro la nómina fiscal externa?");
  assert.ok(unrelated.length <= 3);
  assert.ok(unrelated.every((item) => initialManualSuggestions(manual).includes(item) || /horario|asistencia|empresa|empleados|QR|PIN|sesión/i.test(item)));
  assert.deepEqual(relatedManualSuggestions(manual, "¿Qué hago con qzxw987?").slice(0, 3), initialManualSuggestions(manual).slice(0, 3));
});

test("las respuestas conservan pasos completos del manual en lugar de fragmentos aislados", () => {
  const result = answerFromManual(manual, "¿Cómo creo una plantilla y asigno horarios?");
  assert.equal(result.found, true);
  assert.match(result.answer, /Sección: Horarios/);
  assert.match(result.answer, /\b1\. Abre Horarios/);
  assert.match(result.answer, /\b4\. Usa la opción de asignación/);
  assert.match(result.answer, /sucursal, uno o varios empleados y las fechas de vigencia/);
});

test("recupera solo fragmentos relevantes y limita el contexto enviado al modelo", () => {
  const source = "# Horarios\n\nAbre Horarios para consultar el calendario semanal.\n\n# Reportes\n\nAbre Reportes para exportar archivos CSV.";
  const result = retrieveManualContext(source, "¿Cómo consulto horarios?");
  assert.equal(result.found, true);
  assert.match(result.context, /Sección: Horarios/);
  assert.doesNotMatch(result.context, /Sección: Reportes|exportar archivos/);
  assert.ok(result.context.length <= 3600);
});

test("redacta datos detectables antes de formar una pregunta para Gemini", () => {
  const result = redactChatQuestion("El empleado Juan Pérez de empresa Acme: correo juan@example.test, RFC ABC010203XYZ, NSS 12345678901, contraseña: Secreto987, PIN: 123456 y token=eyJabcdefghijklmnopqrstuvwxyz1234567890");
  assert.equal(result.redacted, true);
  assert.doesNotMatch(result.question, /Juan Pérez|Acme|juan@example|ABC010203XYZ|12345678901|Secreto987|123456|eyJabcdefghijklmnopqrstuvwxyz/);
  assert.match(result.question, /dato omitido/);
});

test("configura Gemini desde variables privadas y valida el identificador del modelo", () => {
  assert.equal(geminiConfig({}), null);
  assert.deepEqual(geminiConfig({ GEMINI_API_KEY: "fake-key" }), { apiKey: "fake-key", model: "gemini-2.5-flash" });
  assert.deepEqual(geminiConfig({ GEMINI_API_KEY: "fake-key", GEMINI_MODEL: "gemini-test-model" }), { apiKey: "fake-key", model: "gemini-test-model" });
  assert.equal(geminiConfig({ GEMINI_API_KEY: "fake-key", GEMINI_MODEL: "https://evil.test" }), null);
});

test("Gemini recibe pregunta redactada y solo contexto del manual, usando respuesta simulada", async () => {
  const source = "# Horarios\n\nAbre Horarios para consultar el calendario semanal.\n\n# Reportes\n\nAbre Reportes para exportar archivos CSV.";
  let url = "";
  let headers = {};
  let payload;
  const result = await answerHelpQuestion(source, "¿Cómo consulto horarios? correo qa@example.test", { GEMINI_API_KEY: "fake-test-key" }, async (input, init) => {
    url = String(input);
    headers = init.headers;
    payload = JSON.parse(init.body);
    return Response.json({ candidates: [{ content: { parts: [{ text: "Abre Horarios y consulta el calendario semanal." }] } }] });
  });
  assert.deepEqual(result, { answer: "Abre Horarios y consulta el calendario semanal.", found: true, source: "gemini", suggestions: [] });
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  assert.equal(headers["x-goog-api-key"], "fake-test-key");
  assert.doesNotMatch(url, /fake-test-key/);
  assert.doesNotMatch(JSON.stringify(payload), /fake-test-key/);
  const sentText = payload.contents[0].parts[0].text;
  assert.doesNotMatch(sentText, /qa@example\.test|fake-test-key|Sección: Reportes|archivos CSV/);
  assert.match(sentText, /\[dato omitido\]/);
  assert.match(payload.systemInstruction.parts[0].text, /No uses conocimiento general/);
});

test("sin clave, con cuota agotada o error del proveedor usa la respuesta segura del manual", async () => {
  const source = "# Horarios\n\nAbre Horarios para consultar el calendario semanal.";
  let calls = 0;
  const noKey = await answerHelpQuestion(source, "¿Cómo consulto horarios?", {}, async () => { calls += 1; throw new Error("no se esperaba red"); });
  assert.equal(noKey.source, "manual");
  assert.equal(calls, 0);

  const logs = [];
  const originalError = console.error;
  console.error = (...items) => logs.push(items);
  try {
    const quota = await answerHelpQuestion(source, "¿Cómo consulto horarios? correo qa@example.test", { GEMINI_API_KEY: "private-test-key" }, async () => {
      calls += 1;
      return new Response("quota error", { status: 429 });
    });
    assert.equal(quota.source, "manual");
    const networkFailure = await answerHelpQuestion(source, "¿Cómo consulto horarios?", { GEMINI_API_KEY: "private-test-key" }, async () => { throw new TypeError("request includes private-test-key and user text"); });
    assert.equal(networkFailure.source, "manual");
  } finally {
    console.error = originalError;
  }
  assert.equal(calls, 1);
  assert.ok(logs.length > 0);
  assert.doesNotMatch(JSON.stringify(logs), /qa@example\.test|private-test-key|consulto horarios|user text/);
});

test("si Gemini determina que el manual no basta, dirige al reporte separado", async () => {
  const source = "# Horarios\n\nAbre Horarios para consultar el calendario semanal.";
  const result = await answerHelpQuestion(source, "¿Cómo consulto horarios?", { GEMINI_API_KEY: "fake-key" }, async () => Response.json({ candidates: [{ content: { parts: [{ text: "INSUFFICIENT_MANUAL_CONTEXT" }] } }] }));
  assert.equal(result.found, false);
  assert.equal(result.source, "manual");
  assert.match(result.answer, /Reportar un problema/);
  assert.ok(result.suggestions.length <= 3);
});

test("la respuesta basada en el manual adjunta opciones relacionadas disponibles", async () => {
  const result = await answerHelpQuestion(manual, "¿Dónde consulto mi horario?");
  assert.equal(result.found, true);
  assert.ok(result.suggestions.length > 0 && result.suggestions.length <= 3);
  assert.ok(result.suggestions.includes("¿Cómo creo y asigno un horario?"));
});

test("una sugerencia seleccionada se envía por el mismo flujo de respuesta", () => {
  assert.match(widget, /onClick=\{\(\) => void askQuestion\(suggestion\)\}/);
  assert.match(widget, /fetch\("\/api\/help\/answer"/);
  assert.match(widget, /JSON\.stringify\(\{ question: value \}\)/);
});

test("la ruta inicial entrega preguntas derivadas del manual sin llamar a Gemini", async () => {
  const route = await readFile(new URL("../src/app/api/help/suggestions/route.ts", import.meta.url), "utf8");
  assert.match(route, /initialManualSuggestions\(manual\)/);
  assert.match(route, /docs.*MANUAL-USUARIO\.md/);
  assert.doesNotMatch(route, /generateGroundedManualAnswer|GEMINI_API_KEY/);
  assert.match(route, /isAllowedRequestOrigin/);
  assert.match(route, /Cache-Control.*no-store/);
});

test("limita preguntas por clave anonimizada en una ventana de quince minutos", () => {
  const store = new Map();
  for (let i = 0; i < 20; i += 1) assert.equal(allowHelpQuestion("hashed-client", 1000 + i, store), true);
  assert.equal(allowHelpQuestion("hashed-client", 1021, store), false);
  assert.equal(allowHelpQuestion("hashed-client", 901_001, store), true);
});

test("el widget usa el título Chatbot, permite minimizarlo y mantiene semántica accesible y ubicación móvil", () => {
  assert.match(widget, /aria-haspopup="dialog"/);
  assert.match(widget, /aria-controls="help-dialog"/);
  assert.match(widget, /role="dialog"/);
  assert.match(widget, /aria-live="polite"/);
  assert.match(widget, />Chatbot<\/h2>/);
  assert.doesNotMatch(widget, /Ayuda de QR-asistencia|Respuestas basadas en el manual/);
  assert.match(widget, /Minimizar Chatbot/);
  assert.match(widget, /Restaurar Chatbot/);
  assert.match(widget, /focus-visible:ring/);
  assert.match(widget, /no incluyas nombres/i);
  assert.match(widget, /nivel gratuito de Gemini/i);
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
  const identifiers = sanitizeReportDescription("RFC ABC010203XYZ y NSS 12345678901 deben quedar fuera del reporte.");
  assert.doesNotMatch(identifiers, /ABC010203XYZ|12345678901/);
  assert.match(identifiers, /dato sensible omitido/);
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
