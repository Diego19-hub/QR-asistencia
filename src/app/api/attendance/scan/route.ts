import { z } from "zod";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), companyId: z.string().uuid(), qrToken: z.string().min(40).max(60).regex(/^[A-Za-z0-9_-]+$/), pin: z.string().regex(/^\d{6,12}$/) }).strict(),
  z.object({ action: z.literal("confirm"), companyId: z.string().uuid(), qrToken: z.string().min(40).max(60).regex(/^[A-Za-z0-9_-]+$/), pin: z.string().regex(/^\d{6,12}$/), event: z.enum(["clock_in", "break_start", "break_end", "clock_out"]), idempotencyKey: z.string().uuid(), breakRuleId: z.string().uuid().nullable().optional() }).strict(),
]);

const messages: Record<string, { status: number; message: string }> = {
  "42501": { status: 403, message: "El supervisor o dispositivo no tiene autorización para esta sucursal." },
  P0002: { status: 404, message: "No se reconoció el QR o el empleado no está activo." },
  P0001: { status: 429, message: "El PIN está bloqueado temporalmente. Intenta más tarde." },
  "22023": { status: 422, message: "El PIN, descanso o movimiento no es válido." },
  "23514": { status: 409, message: "El PIN no está configurado o el movimiento no corresponde al estado de la jornada." },
  "23505": { status: 409, message: "El movimiento ya fue procesado. Actualiza el estado de la jornada." },
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return Response.json({ error: { message: "Inicia sesión para continuar." } }, { status: 401 });

  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: { message: "La solicitud no es JSON válido." } }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: { message: "Los datos del escaneo están incompletos o tienen un formato inválido." } }, { status: 422 });

  const data = parsed.data;
  const cookieStore = await cookies();
  const deviceToken = cookieStore.get(`qr_device_${data.companyId}`)?.value;
  if (!deviceToken) return Response.json({ error: { message: "Este dispositivo aún no está autorizado." } }, { status: 403 });

  const result = data.action === "preview"
    ? await supabase.rpc("scan_employee_attendance", {
      p_company_id: data.companyId,
      p_employee_qr_token: data.qrToken,
      p_pin: data.pin,
      p_device_token: deviceToken,
    })
    : await supabase.rpc("confirm_employee_attendance", {
      p_company_id: data.companyId,
      p_employee_qr_token: data.qrToken,
      p_pin: data.pin,
      p_device_token: deviceToken,
      p_event: data.event,
      p_idempotency_key: data.idempotencyKey,
      p_break_rule_id: data.breakRuleId ?? null,
    });

  if (result.error) {
    const mapped = messages[result.error.code ?? ""];
    return Response.json({ error: { message: mapped?.message ?? "No fue posible validar el movimiento." } }, { status: mapped?.status ?? 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ result: result.data }, { headers: { "Cache-Control": "no-store, private" } });
}
