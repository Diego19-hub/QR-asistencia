import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { hasCompletedInvitationAccountSetup, INVITATION_FULL_NAME_MAX_LENGTH, INVITATION_FULL_NAME_MIN_LENGTH, INVITATION_PASSWORD_MAX_LENGTH, INVITATION_PASSWORD_MIN_LENGTH } from "@/lib/access/invitation-password";
import { acceptInvitation, setInvitationPassword } from "./actions";

const roleNames: Record<string, string> = { admin: "Administrador", supervisor: "Supervisor", employee: "Empleado" };

export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ error?: string; accepted?: string; setup?: string; password?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data, error } = await supabase.rpc("list_my_pending_company_invitations");
  if (error) redirect("/login?error=service");
  const invitations = Array.isArray(data) ? data as Array<{ id: string; companyId: string; companyName: string; role: string; email: string; expiresAt: string; shareLinkAvailable?: boolean }> : [];
  const errors: Record<string, string> = {
    invalid: "La invitación no es válida.",
    forbidden: "La invitación ya no puede aceptarse. Contacta al administrador de la empresa.",
    expired: "La invitación venció o fue revocada. Solicita una nueva.",
    invitation: "No encontramos una invitación pendiente para este correo. Solicita que revisen o reenvíen la invitación.",
    email: "Confirma el correo desde el enlace recibido antes de configurar tu cuenta.",
    name: "Escribe tu nombre completo para continuar.",
    password: `La contraseña debe tener entre ${INVITATION_PASSWORD_MIN_LENGTH} y ${INVITATION_PASSWORD_MAX_LENGTH} caracteres.`,
    "password-match": "Las contraseñas no coinciden.",
    "password-policy": "La contraseña no cumple la política de seguridad configurada en Auth. Prueba otra contraseña que cumpla los requisitos y vuelve a intentarlo.",
    "setup-retry": "No se pudo terminar la configuración segura. Tu contraseña pudo haberse actualizado; puedes volver a enviar el formulario o iniciar sesión con la contraseña elegida y abrir de nuevo la invitación.",
  };
  const errorMessage = query.error ? errors[query.error] : undefined;
  if (!invitations.length && !errorMessage) {
    const { data: memberships } = await supabase.from("company_memberships").select("id,role").eq("user_id", auth.user.id).eq("active", true);
    if (memberships?.length === 1) redirect(memberships[0].role === "owner" || memberships[0].role === "admin" ? "/admin" : memberships[0].role === "supervisor" ? "/scanner" : "/mi-qr");
    if (memberships && memberships.length > 1) redirect("/seleccionar-empresa");
    redirect("/login?error=no-company");
  }
  const emailVerified = Boolean(auth.user.email && auth.user.email_confirmed_at);
  const needsPasswordSetup = !hasCompletedInvitationAccountSetup(auth.user.app_metadata?.access_setup_completed_at);
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
    <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-9">
      <p className="text-xs font-semibold uppercase tracking-[.15em] text-blue-700">Asistencia QR</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-950">{needsPasswordSetup ? "Completar cuenta y aceptar invitación" : "Aceptar invitación"}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">Confirma que esta invitación corresponde a tu cuenta. La empresa y el acceso se validan de nuevo en el servidor.</p>
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label="Correo de la invitación">
        <p className="text-xs font-semibold text-slate-600">Correo de la invitación</p>
        <p className="mt-1 break-all text-sm font-medium text-slate-900">{auth.user.email ?? "Correo no disponible"}</p>
        <p className="mt-1 text-xs text-slate-500">{emailVerified ? "Correo confirmado por Supabase Auth" : "El correo todavía debe confirmarse desde el enlace recibido"}</p>
      </div>
      {errorMessage ? <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{errorMessage}</p> : null}
      {query.accepted ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Invitación aceptada.</p> : null}
      {query.setup === "complete" ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Cuenta configurada. Ahora acepta la invitación para activar el acceso a la empresa.</p> : null}
      {!emailVerified ? <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Confirma primero el correo con el enlace de invitación recibido. Si venció o no llegó, solicita que reenvíen la invitación.</p> : null}
      {needsPasswordSetup ? <form action={setInvitationPassword} className="mt-6 space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
        <h2 className="text-sm font-semibold text-blue-950">Completa tu perfil de acceso</h2>
        <p className="text-xs leading-5 text-blue-900">El nombre se guarda solo como dato de presentación. La contraseña se valida con la política vigente de Supabase Auth; nunca se envía al administrador ni se guarda en el perfil.</p>
        <label className="block text-xs font-semibold text-slate-700">Nombre completo<input name="fullName" type="text" minLength={INVITATION_FULL_NAME_MIN_LENGTH} maxLength={INVITATION_FULL_NAME_MAX_LENGTH} autoComplete="name" required className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" defaultValue={typeof auth.user.user_metadata?.full_name === "string" ? auth.user.user_metadata.full_name : ""} /></label>
        <label className="block text-xs font-semibold text-slate-700">Contraseña<input name="password" type="password" minLength={INVITATION_PASSWORD_MIN_LENGTH} maxLength={INVITATION_PASSWORD_MAX_LENGTH} autoComplete="new-password" required className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
        <label className="block text-xs font-semibold text-slate-700">Confirmar contraseña<input name="confirmation" type="password" minLength={INVITATION_PASSWORD_MIN_LENGTH} maxLength={INVITATION_PASSWORD_MAX_LENGTH} autoComplete="new-password" required className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
        <button disabled={!emailVerified} className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Guardar datos y continuar</button>
      </form> : null}
      <div className="mt-6 space-y-3">{invitations.map((invitation) => <form key={invitation.id} action={acceptInvitation} className="rounded-xl border border-slate-200 p-4">
        <input type="hidden" name="invitationId" value={invitation.id} />
        <p className="font-semibold text-slate-900">{invitation.companyName}</p>
        <p className="mt-1 text-sm text-slate-700">Acceso: {roleNames[invitation.role] ?? "Usuario"}</p>
        <p className="mt-2 text-xs text-slate-600">Vence: {new Date(invitation.expiresAt).toLocaleDateString("es-MX")}</p>
        {invitation.shareLinkAvailable ? <p className="mt-2 text-xs leading-5 text-emerald-800">Puedes aceptar aquí desde tu cuenta con correo confirmado o usar el enlace individual de WhatsApp. El primer método que completes invalida el otro.</p> : <p className="mt-2 text-xs text-slate-500">Acepta con la cuenta cuyo correo recibió la invitación.</p>}
        <button disabled={needsPasswordSetup || !emailVerified} className="mt-4 h-10 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">Aceptar invitación</button>
      </form>)}</div>
    </section>
  </main>;
}
