import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { employeeIdSchema } from "@/lib/employees/validation";
import { credentialApiError } from "@/lib/employees/credential-api-error";
import { decryptEmployeeQrToken, encryptEmployeeQrToken, parseEmployeeQrEncryptionKey } from "@/lib/employees/qr-token-encryption";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const postPayloadSchema = z.object({
  action: z.enum(["issue", "recover"]).optional(),
  replace: z.boolean().optional(),
}).strict();

function privateCredentialResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
}

function encryptionKeyError() {
  return privateCredentialResponse({ error: {
    code: "credential_encryption_unavailable",
    message: "La recuperación segura de QR no está configurada. El administrador debe configurar QR_CREDENTIAL_ENCRYPTION_KEY en el servidor con 64 caracteres hexadecimales (32 bytes). No se emitió ni mostró ninguna credencial.",
  } }, 503);
}

export async function GET(request: Request, { params }: RouteContext) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!employeeIdSchema.safeParse(id).success) return apiError("invalid_employee_id", "El identificador de empleado no es válido.", 400);

  const { data, error } = await result.scope.supabase.rpc("get_employee_credential_status", {
    p_company_id: result.scope.company.companyId,
    p_employee_id: id,
  });
  if (error) return credentialApiError(error);
  return privateCredentialResponse({ credential: data });
}

export async function POST(request: Request, { params }: RouteContext) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!employeeIdSchema.safeParse(id).success) return apiError("invalid_employee_id", "El identificador de empleado no es válido.", 400);

  let payload: unknown;
  try { payload = await request.json(); } catch { return apiError("invalid_json", "El cuerpo de la solicitud no es JSON válido.", 400); }
  const parsedPayload = postPayloadSchema.safeParse(payload);
  if (!parsedPayload.success || (parsedPayload.data.action === "recover" && parsedPayload.data.replace !== undefined)) {
    return apiError("invalid_payload", "La solicitud de credencial no es válida.", 400);
  }

  let encryptionKey: Buffer;
  try { encryptionKey = parseEmployeeQrEncryptionKey(process.env.QR_CREDENTIAL_ENCRYPTION_KEY); }
  catch { return encryptionKeyError(); }

  if (parsedPayload.data.action === "recover") {
    // This explicit, non-cacheable action reads the existing encrypted envelope.
    // It does not issue, rotate, revoke, or audit a credential.
    const { data, error } = await result.scope.supabase.rpc("get_employee_qr_credential_envelope", {
      p_company_id: result.scope.company.companyId,
      p_employee_id: id,
    });
    if (error) return credentialApiError(error);
    const credential = data as { qrStatus?: string; issuedAt?: string | null; revokedAt?: string | null; encryptedToken?: string | null } | null;
    if (!credential || credential.qrStatus !== "active") {
      return privateCredentialResponse({ error: { code: "credential_not_active", message: "No hay una credencial QR activa para consultar." } }, 409);
    }
    if (!credential.encryptedToken) {
      return privateCredentialResponse({ error: {
        code: "credential_recovery_required",
        message: "Este QR se emitió antes de habilitar la recuperación segura. Regénéralo una vez para poder volver a mostrarlo; el código anterior dejará de funcionar.",
      } }, 409);
    }
    let rawToken: string;
    try {
      rawToken = decryptEmployeeQrToken(credential.encryptedToken, encryptionKey, result.scope.company.companyId, id);
    } catch {
      return privateCredentialResponse({ error: {
        code: "credential_recovery_unavailable",
        message: "No se pudo recuperar este QR con la clave actual. Verifica que sea la misma clave del servidor usada al cifrarlo o regenera la credencial.",
      } }, 503);
    }
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(rawToken)) {
      return privateCredentialResponse({ error: { code: "credential_recovery_unavailable", message: "No se pudo validar la credencial. Contacta a la administración." } }, 503);
    }
    return privateCredentialResponse({ credential: { qrStatus: "active", issuedAt: credential.issuedAt ?? null }, token: rawToken });
  }

  const replace = parsedPayload.data.replace === true;
  // Persist only the digest and authenticated ciphertext; return the raw token
  // once to the authorized administrator who issued it.
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  const encryptedToken = encryptEmployeeQrToken(rawToken, encryptionKey, result.scope.company.companyId, id);
  const { data, error } = await result.scope.supabase.rpc("issue_employee_qr_token_with_ciphertext", {
    p_company_id: result.scope.company.companyId,
    p_employee_id: id,
    p_token_hash_hex: tokenHash,
    p_encrypted_token: encryptedToken,
    p_replace: replace,
  });
  if (error) return credentialApiError(error);
  return privateCredentialResponse({ credential: data, token: rawToken });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { id } = await params;
  if (!employeeIdSchema.safeParse(id).success) return apiError("invalid_employee_id", "El identificador de empleado no es válido.", 400);

  const { data, error } = await result.scope.supabase.rpc("revoke_employee_qr_token", {
    p_company_id: result.scope.company.companyId,
    p_employee_id: id,
  });
  if (error) return credentialApiError(error);
  return Response.json({ credential: data }, { headers: { "Cache-Control": "no-store" } });
}
