import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { answerFromManual } from "@/lib/help/manual-assistant";
import { isAllowedRequestOrigin } from "@/lib/http/request-origin";
import { readLimitedBody } from "@/lib/http/read-limited-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ question: z.string().trim().min(2).max(300) }).strict();

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) return Response.json({ error: "Origen no autorizado." }, { status: 403 });
  try {
    const raw = await readLimitedBody(request, 3000);
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return Response.json({ error: "Escribe una pregunta de hasta 300 caracteres." }, { status: 400 });
    const manual = await readFile(join(process.cwd(), "docs", "MANUAL-USUARIO.md"), "utf8");
    const result = answerFromManual(manual, parsed.data.question);
    return Response.json(result, { headers: { "Cache-Control": "no-store, private" } });
  } catch (reason) {
    if (reason instanceof RangeError) return Response.json({ error: "La pregunta supera el tamaño permitido." }, { status: 413 });
    if (reason instanceof SyntaxError) return Response.json({ error: "Escribe una pregunta válida." }, { status: 400 });
    return Response.json({ error: "La ayuda no está disponible en este momento." }, { status: 503, headers: { "Cache-Control": "no-store, private" } });
  }
}
