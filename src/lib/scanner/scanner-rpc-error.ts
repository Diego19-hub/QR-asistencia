const missingFunctionCodes = new Set(["PGRST202", "PGRST203", "42883"]);

export type ScannerRpcFailureKind = "authorization" | "schema_unavailable" | "temporary";
export type ScannerRpcErrorResponse = { code: string; message: string; status: number };

export function classifyScannerRpcFailure(error: unknown): ScannerRpcFailureKind {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;

  if (code === "42501") return "authorization";
  if (typeof code === "string" && missingFunctionCodes.has(code)) return "schema_unavailable";
  return "temporary";
}

export function scannerRpcErrorResponse(
  error: unknown,
  fallbackMessage: string,
  authorizationMessage = "Tu cuenta no tiene permisos de escaneo activos para esta empresa.",
): ScannerRpcErrorResponse {
  const kind = classifyScannerRpcFailure(error);
  if (kind === "authorization") return { code: "supervisor_forbidden", message: authorizationMessage, status: 403 };
  if (kind === "schema_unavailable") {
    return {
      code: "scanner_schema_not_ready",
      message: "La base de datos aún requiere una actualización para habilitar el escáner. Contacta al administrador.",
      status: 503,
    };
  }
  return { code: "scanner_context_failed", message: fallbackMessage, status: 503 };
}
