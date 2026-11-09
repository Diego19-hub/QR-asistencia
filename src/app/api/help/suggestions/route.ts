import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { initialManualSuggestions } from "@/lib/help/manual-assistant";
import { isAllowedRequestOrigin } from "@/lib/http/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAllowedRequestOrigin(request)) return Response.json({ error: "Origen no autorizado." }, { status: 403 });
  try {
    const manual = await readFile(join(process.cwd(), "docs", "MANUAL-USUARIO.md"), "utf8");
    return Response.json({ suggestions: initialManualSuggestions(manual) }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return Response.json({ error: "Las preguntas recomendadas no están disponibles." }, { status: 503, headers: { "Cache-Control": "no-store, private" } });
  }
}
