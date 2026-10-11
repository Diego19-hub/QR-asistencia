import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { isAllowedRequestOrigin } from "@/lib/http/request-origin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const payloadSchema = z.object({ companyId: z.string().uuid(), branchId: z.string().uuid(), label: z.string().trim().min(1).max(100) }).strict();

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) return Response.json({ error: { code: "invalid_origin", message: "Origen no autorizado. Abre el escáner desde el dominio HTTPS configurado." } }, { status: 403 });
  try {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return Response.json({ error: { code: "auth_required", message: "Inicia sesión para continuar." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: { code: "invalid_device_request", message: "La solicitud no es JSON válido." } }, { status: 400 }); }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: { code: "invalid_device_request", message: "Selecciona una sucursal y proporciona un nombre para el dispositivo." } }, { status: 422 });

  const store = await cookies();
  const cookieName = `qr_enroll_${parsed.data.companyId}`;
  const challenge = store.get(cookieName)?.value ?? randomBytes(32).toString("base64url");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  store.set(cookieName, challenge, { httpOnly: true, secure: process.env.NODE_ENV === "production" || forwardedProto === "https", sameSite: "lax", path: "/api", maxAge: 60 * 60 * 24 * 7 });
  const { data, error } = await supabase.rpc("request_supervisor_device", {
    p_company_id: parsed.data.companyId,
    p_branch_id: parsed.data.branchId,
    p_label: parsed.data.label,
    p_challenge: challenge,
  });
  if (error) {
    store.delete(cookieName);
    const forbidden = error.code === "42501";
    const invalid = error.code === "22023";
    return Response.json({ error: {
      code: forbidden ? "supervisor_forbidden" : invalid ? "invalid_device_request" : "device_request_failed",
      message: forbidden
        ? "Tu membresía de supervisor no tiene acceso a esta sucursal. Contacta al administrador."
        : invalid
          ? "La solicitud de autorización tiene datos inválidos. Revisa la sucursal y el nombre del dispositivo."
          : "No fue posible solicitar autorización del dispositivo. Intenta de nuevo.",
    } }, { status: forbidden ? 403 : invalid ? 422 : 503 });
  }
  return Response.json({ request: data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: { code: "device_request_failed", message: "No fue posible procesar la solicitud de autorización. Intenta de nuevo." } }, { status: 503 });
  }
}
