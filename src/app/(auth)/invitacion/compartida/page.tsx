import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { loginPathForAccessDestination } from "@/lib/access/access-links";
import { SharedInvitationAcceptance } from "./shared-invitation-acceptance";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function SharedInvitationPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
    <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-9">
      <p className="text-xs font-semibold uppercase tracking-[.15em] text-blue-700">Asistencia QR</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-950">Invitación individual</h1>
      {!user ? <>
        <p className="mt-3 text-sm leading-6 text-slate-600">Inicia sesión con la cuenta del correo al que se envió la invitación. Si aún no tienes cuenta, primero completa la invitación de Supabase Auth recibida por correo y después vuelve a este enlace. WhatsApp no crea cuentas ni demuestra tu identidad.</p>
        <Link href={loginPathForAccessDestination("/invitacion/compartida")} className="mt-6 inline-flex h-11 items-center rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white">Iniciar sesión para continuar</Link>
      </> : !user.email_confirmed_at ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Confirma el correo de tu cuenta de Asistencia QR antes de aceptar. El enlace de WhatsApp no verifica tu identidad.</p> : <>
        <p className="mt-3 text-sm leading-6 text-slate-600">Sesión autenticada. Acepta solo si esperabas esta invitación y la dirección de tu cuenta coincide con la invitación.</p>
      </>}
      <SharedInvitationAcceptance canAccept={Boolean(user?.email_confirmed_at)} />
      <p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">Las invitaciones vencen y se usan una sola vez. Si el enlace dejó de funcionar, solicita otro a la persona administradora.</p>
    </section>
  </main>;
}
