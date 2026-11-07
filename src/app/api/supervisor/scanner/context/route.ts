import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { isAllowedRequestOrigin } from "@/lib/http/request-origin";
import { createClient } from "@/lib/supabase/server";
import { scannerRpcErrorResponse } from "@/lib/scanner/scanner-rpc-error";

export const runtime = "nodejs";

function contextError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store, private" } });
}

function scannerRpcFailure(error: unknown, fallbackMessage: string) {
  const failure = scannerRpcErrorResponse(error, fallbackMessage);
  return contextError(failure.code, failure.message, failure.status);
}

function cookieBase(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return { httpOnly: true, secure: process.env.NODE_ENV === "production" || forwardedProto === "https", sameSite: "lax" as const, path: "/api", maxAge: 60 * 60 * 24 * 365 };
}

async function scannerContext(request: Request, enableBrowser: boolean) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return contextError("auth_required", "Inicia sesión para continuar.", 401);

  const { data: memberships, error } = await supabase.from("company_memberships").select("id,company_id")
    .eq("user_id", auth.user.id).eq("role", "supervisor").eq("active", true);
  if (error) return contextError("membership_lookup_failed", "No fue posible validar la membresía del supervisor.", 503);

  const store = await cookies();
  const selectedId = store.get("qr_active_membership_id")?.value;
  const selectedMembership = selectedId ? (memberships ?? []).find((membership) => membership.id === selectedId) : null;
  const allMemberships = await supabase.from("company_memberships").select("id,role")
    .eq("user_id", auth.user.id).eq("active", true);
  if (allMemberships.error) return contextError("membership_lookup_failed", "No fue posible validar la membresía del supervisor.", 503);
  const soleSupervisor = allMemberships.data?.length === 1 && memberships?.length === 1 ? memberships[0] : null;
  const activeSupervisor = selectedMembership ?? soleSupervisor;
  if (!activeSupervisor && (allMemberships.data ?? []).length > 1) return contextError("company_selection_required", "Selecciona una empresa y el rol de supervisor antes de abrir el escáner.", 409);
  if (!activeSupervisor) return contextError("supervisor_forbidden", "La membresía seleccionada no tiene acceso de supervisor.", 403);
  const requestedCompany = new URL(request.url).searchParams.get("companyId");
  const companyIds = [activeSupervisor.company_id];
  if (requestedCompany && requestedCompany !== activeSupervisor.company_id) return contextError("supervisor_forbidden", "No tienes acceso de supervisor a esta empresa seleccionada.", 403);

  const contexts: Record<string, unknown>[] = [];
  for (const companyId of companyIds) {
    const deviceCookie = `qr_device_${companyId}`;
    let deviceToken = store.get(deviceCookie)?.value ?? null;
    const readContext = async () => await supabase.rpc("get_supervisor_scanner_context", {
      p_company_id: companyId,
      p_device_token: deviceToken,
    });
    let { data, error: scannerError } = await readContext();
    if (scannerError) {
      return scannerRpcFailure(scannerError, "No fue posible cargar la sucursal del supervisor. Intenta de nuevo.");
    }
    let context = data as Record<string, unknown>;
    const branches = Array.isArray(context.branches) ? context.branches as { id?: unknown }[] : [];

    // POST is called by the authenticated scanner page after the server has
    // selected this membership. An active branch assignment is the approval:
    // mint a per-browser secret and bind its hash to the first assigned active
    // branch. Never create a device for a supervisor with no active branch.
    if (enableBrowser && !context.authorized && branches.length > 0) {
      const token = deviceToken ?? randomBytes(32).toString("base64url");
      const branchId = typeof branches[0]?.id === "string" ? branches[0].id : null;
      if (!branchId) return contextError("scanner_context_failed", "No fue posible validar la sucursal asignada.", 503);
      const { error: enrollmentError } = await supabase.rpc("ensure_supervisor_scanner_device", {
        p_company_id: companyId,
        p_branch_id: branchId,
        p_label: "Navegador del supervisor",
        p_device_token: token,
      });
      if (enrollmentError) {
        const failure = scannerRpcErrorResponse(
          enrollmentError,
          "No fue posible habilitar este navegador. Intenta de nuevo.",
          "El acceso del navegador, la membresía o la sucursal ya no está autorizado.",
        );
        return contextError(failure.code, failure.message, failure.status);
      }
      if (!deviceToken) store.set(deviceCookie, token, cookieBase(request));
      deviceToken = token;
      ({ data, error: scannerError } = await readContext());
      if (scannerError) return scannerRpcFailure(scannerError, "No fue posible cargar la sucursal del supervisor.");
      context = data as Record<string, unknown>;
    }
    contexts.push({ ...context, requestStatus: context.authorized ? "authorized" : "unrequested" });
  }
  return Response.json({ contexts }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function GET(request: Request) {
  try {
    return await scannerContext(request, false);
  } catch {
    return Response.json({ error: { code: "scanner_context_failed", message: "No fue posible cargar la sucursal del supervisor. Intenta de nuevo." } }, { status: 503, headers: { "Cache-Control": "no-store, private" } });
  }
}

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) {
    return contextError("invalid_origin", "Origen no autorizado. Abre el escáner desde el dominio HTTPS configurado.", 403);
  }
  try {
    return await scannerContext(request, true);
  } catch {
    return Response.json({ error: { code: "scanner_context_failed", message: "No fue posible cargar la sucursal del supervisor. Intenta de nuevo." } }, { status: 503, headers: { "Cache-Control": "no-store, private" } });
  }
}
