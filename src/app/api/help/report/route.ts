import { createHash } from "node:crypto";
import { isAllowedRequestOrigin } from "@/lib/http/request-origin";
import { readLimitedBody } from "@/lib/http/read-limited-body";
import { allowHelpReport, deliverHelpReport, validateHelpReport } from "@/lib/help/manual-assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requesterKey(request: Request) {
  const address = request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(address).digest("hex");
}

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) return Response.json({ error: "Origen no autorizado." }, { status: 403 });
  let payload: unknown;
  try { payload = JSON.parse(await readLimitedBody(request, 6000)); }
  catch (reason) {
    if (reason instanceof RangeError) return Response.json({ error: "El reporte supera el tamaño permitido." }, { status: 413 });
    return Response.json({ error: "El formulario no contiene datos válidos." }, { status: 400 });
  }

  const result = validateHelpReport(payload);
  if (!result.ok) return Response.json({ error: result.message }, { status: 400 });

  // Missing configuration is checked before rate accounting and before any outbound request.
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim() || !process.env.TELEGRAM_CHAT_ID?.trim()) {
    return Response.json({ error: "El envío de reportes todavía no está configurado. Contacta a la administración." }, { status: 503, headers: { "Cache-Control": "no-store, private" } });
  }
  if (!allowHelpReport(requesterKey(request))) return Response.json({ error: "Se alcanzó el límite temporal de reportes. Intenta más tarde." }, { status: 429, headers: { "Cache-Control": "no-store, private", "Retry-After": "900" } });

  const delivery = await deliverHelpReport(result.report);
  if (delivery === "not_configured") return Response.json({ error: "El envío de reportes todavía no está configurado. Contacta a la administración." }, { status: 503, headers: { "Cache-Control": "no-store, private" } });
  if (delivery === "failed") return Response.json({ error: "No se pudo enviar el reporte. Intenta más tarde o contacta a la administración." }, { status: 502, headers: { "Cache-Control": "no-store, private" } });
  return Response.json({ ok: true, message: "Reporte enviado. Gracias por ayudarnos a mejorar." }, { headers: { "Cache-Control": "no-store, private" } });
}
