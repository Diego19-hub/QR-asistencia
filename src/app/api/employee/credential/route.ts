import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { decryptQrToken } from "@/lib/employees/qr-token-encryption";

export const runtime = "nodejs";

function failure(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
}

export async function GET(request: Request) {
  const employeeId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("employeeId"));
  if (!employeeId.success) return failure("invalid_employee", "No se pudo validar tu expediente de empleado.", 400);
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return failure("unauthenticated", "Inicia sesión para consultar tu credencial.", 401);

  const { data: employee, error: employeeError } = await supabase.from("employees")
    .select("id,company_id").eq("id", employeeId.data).eq("auth_user_id", auth.user.id).eq("active", true).maybeSingle();
  if (employeeError) return failure("employee_lookup_failed", "No fue posible validar tu expediente.", 503);
  if (!employee) return failure("employee_forbidden", "No tienes acceso a esta credencial.", 403);

  const { data, error } = await supabase.rpc("get_own_employee_qr_credential", {
    p_company_id: employee.company_id,
    p_employee_id: employee.id,
  });
  if (error) return failure(error.code === "42501" ? "employee_forbidden" : "credential_lookup_failed",
    error.code === "42501" ? "No tienes acceso a esta credencial." : "No fue posible consultar la credencial.",
    error.code === "42501" ? 403 : 503);

  const credential = data as { status?: string; issuedAt?: string | null; revokedAt?: string | null; encryptedToken?: string | null; recoverable?: boolean };
  if (credential.status !== "active") return Response.json({ status: credential.status ?? "not_issued", issuedAt: credential.issuedAt ?? null, revokedAt: credential.revokedAt ?? null }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  if (!credential.encryptedToken) return Response.json({ status: "active", recoverable: false, issuedAt: credential.issuedAt ?? null }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });

  let token: string;
  try { token = decryptQrToken(credential.encryptedToken, employee.company_id, employee.id); }
  catch { return failure("credential_recovery_unavailable", "No se puede mostrar la credencial. La administración debe verificar la clave del servidor o regenerarla.", 503); }
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return failure("credential_recovery_unavailable", "No se pudo validar la credencial. Contacta a la administración.", 503);
  return Response.json({ status: "active", issuedAt: credential.issuedAt ?? null, token }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
}
