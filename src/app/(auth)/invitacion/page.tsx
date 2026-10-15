import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { acceptInvitation, setInvitationPassword } from "./actions";

const roleNames: Record<string, string> = { admin: "Administrador", supervisor: "Supervisor", employee: "Empleado" };

export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ error?: string; accepted?: string; password?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data, error } = await supabase.rpc("list_my_pending_company_invitations");
  if (error) redirect("/login?error=service");
  const invitations = Array.isArray(data) ? data as Array<{ id: string; companyId: string; companyName: string; role: string; email: string; expiresAt: string }> : [];
  if (!invitations.length) {
    const { data: memberships } = await supabase.from("company_memberships").select("id,role").eq("user_id", auth.user.id).eq("active", true);
    if (memberships?.length === 1) redirect(memberships[0].role === "owner" || memberships[0].role === "admin" ? "/admin" : memberships[0].role === "supervisor" ? "/scanner" : "/mi-qr");
    if (memberships && memberships.length > 1) redirect("/seleccionar-empresa");
    redirect("/login?error=no-company");
  }
  const errors: Record<string, string> = {
    invalid: "La invitación no es válida.",
    forbidden: "La invitación ya no puede aceptarse. Contacta al administrador de la empresa.",
    expired: "La invitación venció o fue revocada. Solicita una nueva.",
    password: "La contraseña no cumple los requisitos o las dos entradas no coinciden.",
  };
  const needsPasswordSetup = Boolean(auth.user.invited_at && !auth.user.user_metadata?.access_setup_completed_at);
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
    <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-9">
      <p className="text-xs font-semibold uppercase tracking-[.15em] text-blue-700">Asistencia QR</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-950">Invitaciones de acceso</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">Sesión iniciada como {auth.user.email}. Acepta únicamente una invitación destinada a tu cuenta.</p>
      {query.error && errors[query.error] ? <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{errors[query.error]}</p> : null}
      {query.accepted ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Invitación aceptada.</p> : null}
      {query.password === "updated" ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Contraseña configurada. Ya puedes aceptar la invitación.</p> : null}
      {needsPasswordSetup ? <form action={setInvitationPassword} className="mt-6 space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
        <h2 className="text-sm font-semibold text-blue-950">Configura tu contraseña</h2>
        <p className="text-xs leading-5 text-blue-900">Elige una contraseña de al menos 12 caracteres. Nunca se envía al administrador.</p>
        <label className="block text-xs font-semibold text-slate-700">Nueva contraseña<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
        <label className="block text-xs font-semibold text-slate-700">Confirma la contraseña<input name="confirmation" type="password" minLength={12} maxLength={128} autoComplete="new-password" required className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
        <button className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white">Guardar contraseña</button>
      </form> : null}
      <div className="mt-6 space-y-3">{invitations.map((invitation) => <form key={invitation.id} action={acceptInvitation} className="rounded-xl border border-slate-200 p-4">
        <input type="hidden" name="invitationId" value={invitation.id} />
        <p className="font-semibold text-slate-900">{invitation.companyName}</p>
        <p className="mt-1 text-sm text-slate-600">Acceso: {roleNames[invitation.role] ?? "Usuario"}</p>
        <p className="mt-1 text-xs text-slate-500">Vence: {new Date(invitation.expiresAt).toLocaleDateString("es-MX")}</p>
        <button disabled={needsPasswordSetup} className="mt-4 h-10 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">Aceptar invitación</button>
      </form>)}</div>
    </section>
  </main>;
}
