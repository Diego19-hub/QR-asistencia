import { NextResponse, type NextRequest } from "next/server";

import { getAuthRedirectLocation } from "@/lib/access/auth-redirect";
import { createClient } from "@/lib/supabase/server";

function redirectAuth(target: "invitation" | "login-invite-error") {
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
  if (!code || code.length > 4096 || (requestedNext !== null && requestedNext !== "/invitacion")) {
    return redirectAuth("login-invite-error");
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirectAuth("login-invite-error");
  return redirectAuth("invitation");
}
