import { NextResponse, type NextRequest } from "next/server";

import { getAuthRedirectLocation } from "@/lib/access/auth-redirect";
import { createClient } from "@/lib/supabase/server";

function redirectAuth(target: "invitation" | "first-company" | "login-invite-error") {
  const location = getAuthRedirectLocation(target);
  if (!location) return new NextResponse("El retorno seguro de autenticación no está configurado.", { status: 503, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  const response = NextResponse.redirect(new URL(location.slice(0, -1)), 303);
  response.headers.set("Location", location);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  const codes = request.nextUrl.searchParams.getAll("code");
  const nextValues = request.nextUrl.searchParams.getAll("next");
  const code = codes.length === 1 ? codes[0] : null;
  const requestedNext = nextValues.length === 1 ? nextValues[0] : null;
  const registrationCallback = requestedNext === "/crear-empresa";
  if ((requestedNext !== "/invitacion" && !registrationCallback) || codes.length > 1 || (code !== null && code.length > 4096) || (!code && !registrationCallback)) {
    return redirectAuth("login-invite-error");
  }
  const supabase = await createClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return redirectAuth("login-invite-error");
  }
  if (registrationCallback) {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email_confirmed_at) return redirectAuth("login-invite-error");
    return redirectAuth("first-company");
  }
  return redirectAuth("invitation");
}
