type CredentialRpcError = { code?: string };

/**
 * Keep employee-not-found and cross-company lookups indistinguishable at the
 * Next.js API boundary. The credential RPC scopes its lookup by company ID,
 * so both cases surface as PostgreSQL P0002.
 */
export function credentialApiError(error: CredentialRpcError): Response {
  if (error.code === "42501") {
    return Response.json(
      { error: { code: "credential_forbidden", message: "No tienes permiso para administrar las credenciales de este empleado." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error.code === "P0002") {
    return Response.json(
      { error: { code: "employee_not_found", message: "No se encontró el empleado en esta empresa." } },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error.code === "23514") {
    return Response.json(
      { error: { code: "employee_inactive", message: "Activa el expediente antes de emitir una credencial." } },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error.code === "23505") {
    return Response.json(
      { error: { code: "qr_already_active", message: "El empleado ya tiene un QR activo. Usa Regenerar para sustituirlo." } },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error.code === "22023") {
    return Response.json(
      { error: { code: "invalid_credential", message: "El valor de la credencial no cumple el formato requerido." } },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error.code === "P0001") {
    return Response.json(
      { error: { code: "qr_rate_limited", message: "Se alcanzó el límite temporal de emisiones. Intenta nuevamente más tarde." } },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { error: { code: "credential_operation_failed", message: "No fue posible completar la operación de credenciales." } },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
