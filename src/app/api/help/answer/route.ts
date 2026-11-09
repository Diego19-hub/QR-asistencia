import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";

import {
  allowHelpQuestion,
  answerHelpQuestion,
} from "@/lib/help/manual-assistant";
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
    const clientAddress = request.headers.get("cf-connecting-ip")?.trim()
      || request.headers.get("x-real-ip")?.trim()
      || "anonymous";
    const rateKey = createHash("sha256").update(clientAddress).digest("hex");
    if (!allowHelpQuestion(rateKey)) {
      return Response.json({ error: "Has enviado varias preguntas. Espera unos minutos antes de volver a intentarlo." }, { status: 429, headers: { "Cache-Control": "no-store, private", "Retry-After": "900" } });
    }

    const manual = await readFile(join(process.cwd(), "docs", "MANUAL-USUARIO.md"), "utf8");
    const result = await answerHelpQuestion(manual, parsed.data.question);
    return Response.json(result, { headers: { "Cache-Control": "no-store, private" } });
  } catch (reason) {
    if (reason instanceof RangeError) return Response.json({ error: "La pregunta supera el tamaño permitido." }, { status: 413 });
    if (reason instanceof SyntaxError) return Response.json({ error: "Escribe una pregunta válida." }, { status: 400 });
    return Response.json({ error: "La ayuda no está disponible en este momento." }, { status: 503, headers: { "Cache-Control": "no-store, private" } });
  }
}
