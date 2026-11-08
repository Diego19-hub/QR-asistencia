import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { setActiveMembershipCookie } from "@/lib/access/active-membership-cookie";

const schema = z.object({
  name: z.string().trim().min(1).max(180),
  legalName: z.string().trim().max(240).nullable().optional(),
  rfc: z.string().trim().toUpperCase().max(13).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.rfc && !/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(value.rfc)) {
    context.addIssue({ code: "custom", path: ["rfc"], message: "Revisa el formato del RFC." });
  }
});

function error(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store, private" } });
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return error("invalid_json", "La solicitud no contiene datos válidos.", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return error("validation_failed", "Revisa el nombre, la razón social y el RFC.", 422);

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return error("unauthenticated", "Inicia sesión para crear una empresa.", 401);
  const { data, error: rpcError } = await supabase.rpc("create_company_for_current_owner", {
    p_name: parsed.data.name,
    p_legal_name: parsed.data.legalName || null,
    p_rfc: parsed.data.rfc || null,
  });
  if (rpcError?.code === "42501") return error("owner_required", "Solo un propietario activo puede crear otra empresa.", 403);
  if (rpcError?.code === "22023") return error("validation_failed", "Revisa los datos de la empresa.", 422);
  if (rpcError?.code === "23505") return error("company_conflict", "El RFC ya está registrado.", 409);
  if (rpcError || !Array.isArray(data) || !data[0]?.company_id || !data[0]?.membership_id) {
    return error("company_create_unavailable", "No fue posible crear la empresa. Inténtalo más tarde.", 503);
  }
  await setActiveMembershipCookie(data[0].membership_id);
  return Response.json({ item: { id: data[0].company_id, name: data[0].company_name } }, {
    status: 201,
    headers: { "Cache-Control": "no-store, private", Vary: "Cookie" },
  });
}
