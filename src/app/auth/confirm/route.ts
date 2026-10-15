import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { getAuthRedirectLocation } from "@/lib/access/auth-redirect";
import { createClient } from "@/lib/supabase/server";

const allowedTypes = new Set<EmailOtpType>(["invite", "magiclink", "signup"]);
const labels: Record<string, string> = { invite: "Confirmar invitación", magiclink: "Iniciar sesión", signup: "Confirmar correo" };

function redirectAuth(target: "invitation" | "login-invite-error" | "login-confirmed") {
  const location = getAuthRedirectLocation(target);
  if (!location) return new NextResponse("El retorno seguro de autenticación no está configurado.", { status: 503, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  const response = NextResponse.redirect(new URL(location.slice(0, -1)), 303);
  response.headers.set("Location", location);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function safeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
}

function confirmationHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
}

export async function GET(request: NextRequest) {
  const tokenHashes = request.nextUrl.searchParams.getAll("token_hash");
  const types = request.nextUrl.searchParams.getAll("type");
  const tokenHash = tokenHashes.length === 1 ? tokenHashes[0] : null;
  const type = types.length === 1 ? types[0] as EmailOtpType : null;
  if (!tokenHash || tokenHash.length > 512 || !type || !allowedTypes.has(type)) return redirectAuth("login-invite-error");

  // Keep email security scanners from consuming the one-time OTP on a link preview.
  // Verification happens only after the user submits this same-origin form.
  const title = labels[type];
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Asistencia QR</title><body><main><h1>${title}</h1><p>Este enlace es de un solo uso. Continúa para completar la autenticación segura.</p><form method="post" action="/auth/confirm"><input type="hidden" name="token_hash" value="${safeHtml(tokenHash)}"><input type="hidden" name="type" value="${safeHtml(type)}"><button type="submit">${title}</button></form></main></body></html>`;
  return new NextResponse(html, { status: 200, headers: { ...confirmationHeaders(), "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentType !== "application/x-www-form-urlencoded" || (contentLength > 0 && contentLength > 4096)) return redirectAuth("login-invite-error");
  let form: FormData;
  try { form = await request.formData(); } catch { return redirectAuth("login-invite-error"); }
  const tokenHashes = form.getAll("token_hash");
  const types = form.getAll("type");
  const tokenHash = tokenHashes.length === 1 && typeof tokenHashes[0] === "string" ? tokenHashes[0] : null;
  const type = types.length === 1 && typeof types[0] === "string" ? types[0] as EmailOtpType : null;
  if (!tokenHash || tokenHash.length > 512 || !type || !allowedTypes.has(type)) return redirectAuth("login-invite-error");
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return redirectAuth("login-invite-error");
  return redirectAuth(type === "signup" ? "login-confirmed" : "invitation");
}
