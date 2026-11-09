const stopWords = new Set([
  "para", "como", "donde", "cuando", "desde", "puedo", "puede", "quiero", "tengo",
  "esta", "este", "esto", "del", "las", "los", "una", "uno", "por", "con", "que",
  "hay", "mi", "mis", "me", "el", "la", "un", "y", "o", "en", "no", "si", "al",
  "se", "su", "sus", "the", "and", "how", "where", "what", "when",
]);

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
}

function words(value: string) {
  return normalize(value).match(/[a-z0-9]{3,}/g)?.filter((word) => !stopWords.has(word)) ?? [];
}

type ManualParagraph = { heading: string; text: string };

function manualParagraphs(markdown: string): ManualParagraph[] {
  let heading = "Manual de usuario";
  const paragraphs: ManualParagraph[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      heading = headingMatch[1].replace(/[*`]/g, "").trim();
      continue;
    }
    if (line.startsWith("|") || line === "---") continue;
    const text = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").replace(/[`*]/g, "").trim();
    if (text.length >= 24) paragraphs.push({ heading, text });
  }
  return paragraphs;
}

/** Returns short, extractive passages from the supplied manual; it does not generate facts. */
export function answerFromManual(markdown: string, question: string): { answer: string; found: boolean } {
  const terms = [...new Set(words(question))];
  if (!terms.length) return { answer: "No encontré esa información en el manual. Puedes reportar el problema.", found: false };

  const scored = manualParagraphs(markdown).map((paragraph) => {
    const content = normalize(`${paragraph.heading} ${paragraph.text}`);
    const score = terms.reduce((total, term) => total + (content.includes(term) ? 1 : 0), 0);
    return { ...paragraph, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score < Math.min(2, terms.length)) {
    return { answer: "No encontré una respuesta clara en el manual. Puedes reportar el problema.", found: false };
  }

  const bestScore = scored[0].score;
  const matches = scored.filter((item) => item.score >= Math.max(1, bestScore - 1)).slice(0, 3);
  const passages = matches.map(({ heading, text }) => `Sección: ${heading}\n${text.slice(0, 650)}${text.length > 650 ? "…" : ""}`);
  return { answer: `Según el manual:\n\n${passages.join("\n\n")}`, found: true };
}

export const reportablePages = [
  "/login",
  "/seleccionar-empresa",
  "/admin",
  "/admin/configuracion",
  "/admin/supervisores",
  "/admin/empleados",
  "/admin/horarios",
  "/admin/asistencias",
  "/admin/reportes",
  "/admin/horas-extra",
  "/scanner",
  "/mi-qr",
] as const;

export type HelpReport = { description: string; page: (typeof reportablePages)[number] };

const secretValuePatterns = [
  /\b(?:password|contrase(?:n|ñ)a|token|cookie|bearer|authorization|autorizaci[oó]n|pin)\b\s*(?:[:=]|es)?\s*["']?[A-Za-z0-9_./+=-]{4,}["']?/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b[A-Za-z0-9_-]{40,60}\b/g,
  /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi,
];

/** Removes common secret and personal-data shapes before anything leaves the app. */
export function sanitizeReportDescription(value: string): string {
  let result = value;
  for (const pattern of secretValuePatterns) result = result.replace(pattern, "[dato sensible omitido]");
  result = result
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[correo omitido]")
    .replace(/(?:\+?\d[\d ().-]{8,}\d)/g, "[teléfono omitido]");
  return result.replace(/[\t ]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function validateHelpReport(input: unknown): { ok: true; report: HelpReport } | { ok: false; message: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "Revisa los datos del reporte." };
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["description", "page", "website"].includes(key))) return { ok: false, message: "Revisa los datos del reporte." };
  if ("website" in value && (typeof value.website !== "string" || value.website.trim())) return { ok: false, message: "No fue posible procesar el reporte." };
  if (typeof value.description !== "string" || value.description.trim().length < 10 || value.description.length > 1200) {
    return { ok: false, message: "Describe el problema con al menos 10 y hasta 1,200 caracteres." };
  }
  if (typeof value.page !== "string" || !reportablePages.includes(value.page as (typeof reportablePages)[number])) {
    return { ok: false, message: "Selecciona una página válida." };
  }
  const description = sanitizeReportDescription(value.description);
  if (description.replace(/\[[^\]]+ omitido\]/g, "").trim().length < 10) {
    return { ok: false, message: "La descripción contiene muy poca información segura para enviar. No incluyas secretos ni datos personales." };
  }
  return { ok: true, report: { description, page: value.page as HelpReport["page"] } };
}

type TelegramConfig = { token: string; chatId: string };
export function telegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

export async function sendTelegramReport(
  config: TelegramConfig,
  report: HelpReport,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const endpoint = `https://api.telegram.org/bot${config.token}/sendMessage`;
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text: `Página: ${report.page}\nDescripción: ${report.description}`, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const result = await response.json() as { ok?: boolean };
    return result.ok === true;
  } catch {
    return false;
  }
}

export async function deliverHelpReport(
  report: HelpReport,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<"not_configured" | "sent" | "failed"> {
  const config = telegramConfig(env);
  if (!config) return "not_configured";
  return await sendTelegramReport(config, report, fetcher) ? "sent" : "failed";
}

type RateWindow = { count: number; resetAt: number };
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 4;
const globalRateState = globalThis as typeof globalThis & { __helpReportRates?: Map<string, RateWindow> };
const reportRates = globalRateState.__helpReportRates ??= new Map();

/** Best-effort per-process limiter; no report text or raw IP is retained. */
export function allowHelpReport(key: string, now = Date.now(), store = reportRates): boolean {
  for (const [candidate, item] of store) if (item.resetAt <= now) store.delete(candidate);
  const current = store.get(key);
  if (current && current.resetAt > now) {
    if (current.count >= RATE_LIMIT) return false;
    current.count += 1;
    return true;
  }
  if (store.size >= 5000) store.delete(store.keys().next().value as string);
  store.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
  return true;
}
