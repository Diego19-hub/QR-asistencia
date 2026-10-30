import { cookies } from "next/headers";
import { isAllowedRequestOrigin } from "@/lib/http/request-origin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function contextError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store, private" } });
}

function cookieBase(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return { httpOnly: true, secure: process.env.NODE_ENV === "production" || forwardedProto === "https", sameSite: "lax" as const, path: "/api", maxAge: 60 * 60 * 24 * 365 };
}

async function scannerContext(request: Request, redeemChallenge: boolean) {
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
    const challengeName = `qr_enroll_${companyId}`;
    const challenge = store.get(challengeName)?.value;
    const deviceCookie = `qr_device_${companyId}`;
    let deviceToken = store.get(deviceCookie)?.value ?? null;
    let requestStatus = challenge ? "pending" : "unrequested";
    if (challenge && redeemChallenge) {
      const { data: redeem, error: redeemError } = await supabase.rpc("redeem_supervisor_device", { p_company_id: companyId, p_challenge: challenge });
      const redemption = redeem as { status?: string } | null;
      if (!redeemError && redemption?.status === "authorized") {
        deviceToken = challenge;
        store.set(deviceCookie, deviceToken, cookieBase(request));
        store.delete(challengeName);
        requestStatus = "authorized";
      } else if (!redeemError && redemption?.status && redemption.status !== "pending") {
        requestStatus = redemption.status;
        if (redemption.status !== "approved") store.delete(challengeName);
      }
    }
    const { data, error: scannerError } = await supabase.rpc("get_supervisor_scanner_context", {
      p_company_id: companyId,
      p_device_token: deviceToken,
    });
    if (scannerError) {
      const forbidden = scannerError.code === "42501";
      return contextError(
        forbidden ? "supervisor_forbidden" : "scanner_context_failed",
        forbidden
          ? "Tu cuenta no tiene permisos de escaneo activos para esta empresa. Contacta al administrador."
          : "No fue posible cargar la sucursal del supervisor. Intenta de nuevo.",
        forbidden ? 403 : 503,
      );
    }
    const context = data as Record<string, unknown>;
    contexts.push({ ...context, requestStatus });
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
