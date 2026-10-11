import { cookies } from "next/headers";
import { isAllowedRequestOrigin } from "@/lib/http/request-origin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function cookieBase(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return { httpOnly: true, secure: process.env.NODE_ENV === "production" || forwardedProto === "https", sameSite: "lax" as const, path: "/api", maxAge: 60 * 60 * 24 * 365 };
}

async function scannerContext(request: Request, redeemChallenge: boolean) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return Response.json({ error: { code: "auth_required", message: "Inicia sesión para continuar." } }, { status: 401 });

  const { data: memberships, error } = await supabase.from("company_memberships").select("company_id")
    .eq("user_id", auth.user.id).eq("role", "supervisor").eq("active", true);
  if (error) return Response.json({ error: { code: "membership_lookup_failed", message: "No fue posible validar la membresía del supervisor." } }, { status: 503 });

  const requestedCompany = new URL(request.url).searchParams.get("companyId");
  const companyIds = [...new Set((memberships ?? []).map((membership) => membership.company_id))]
    .filter((id) => !requestedCompany || requestedCompany === id);
  if (requestedCompany && !companyIds.includes(requestedCompany)) return Response.json({ error: { code: "supervisor_forbidden", message: "No tienes acceso de supervisor a esta empresa." } }, { status: 403 });

  const store = await cookies();
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
    const { data, error: contextError } = await supabase.rpc("get_supervisor_scanner_context", {
      p_company_id: companyId,
      p_device_token: deviceToken,
    });
    if (contextError) {
      const forbidden = contextError.code === "42501";
      return Response.json({ error: {
        code: forbidden ? "supervisor_forbidden" : "scanner_context_failed",
        message: forbidden
          ? "Tu cuenta no tiene permisos de escaneo activos para esta empresa. Contacta al administrador."
          : "No fue posible cargar la sucursal del supervisor. Intenta de nuevo.",
      } }, { status: forbidden ? 403 : 503, headers: { "Cache-Control": "no-store, private" } });
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
    return Response.json({ error: { code: "invalid_origin", message: "Origen no autorizado. Abre el escáner desde el dominio HTTPS configurado." } }, { status: 403 });
  }
  try {
    return await scannerContext(request, true);
  } catch {
    return Response.json({ error: { code: "scanner_context_failed", message: "No fue posible cargar la sucursal del supervisor. Intenta de nuevo." } }, { status: 503, headers: { "Cache-Control": "no-store, private" } });
  }
}
