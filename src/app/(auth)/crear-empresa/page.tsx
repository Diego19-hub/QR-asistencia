import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { FirstCompanyCompletionForm, OwnerRegistrationForm } from "./registration-form";

type PageProps = { searchParams: Promise<{ error?: string; confirmed?: string }> };

export default async function CreateCompanyPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return <main className="readable-interface flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-9">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-blue-700">Asistencia QR</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Crear cuenta y empresa</h1>
          <p className="mt-2 text-base leading-6 text-slate-600">Registra tu cuenta y crea tu primera empresa. Tu cuenta quedará como Owner de esa empresa.</p>
        </header>
        {query.confirmed ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">Correo confirmado. Inicia sesión para completar la creación de tu empresa.</p> : null}
        {query.error ? <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">No fue posible continuar el alta. Inicia sesión y vuelve a intentarlo.</p> : null}
        <OwnerRegistrationForm />
      </section>
    </main>;
  }

  const { data: pendingInvitations, error: invitationError } = await supabase.rpc("list_my_pending_company_invitations");
  if (!invitationError && Array.isArray(pendingInvitations) && pendingInvitations.length) redirect("/invitacion");

  const { data: memberships, error: membershipsError } = await supabase.from("company_memberships")
    .select("id,role,active").eq("user_id", auth.user.id).limit(1);
  if (membershipsError || invitationError) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10"><section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
      <h1 className="text-2xl font-semibold text-slate-950">No fue posible comprobar tu acceso</h1>
      <p role="alert" className="mt-3 text-sm leading-6 text-slate-700">Actualiza la página o vuelve a iniciar sesión. No se creó una empresa.</p>
      <Link href="/login" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white">Ir a iniciar sesión</Link>
    </section></main>;
  }

  if (memberships?.length) {
    const membership = memberships[0];
    if (membership.active && membership.role === "owner") redirect("/admin");
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10"><section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
      <h1 className="text-2xl font-semibold text-slate-950">Esta cuenta ya está vinculada</h1>
      <p className="mt-3 text-sm leading-6 text-slate-700">Para crear otra empresa, inicia sesión con su cuenta Owner y usa “Crear otra empresa” desde el panel. Si tu acceso está inactivo, contacta al administrador de esa empresa.</p>
      <Link href="/login" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white">Volver a iniciar sesión</Link>
    </section></main>;
  }

  if (!auth.user.email_confirmed_at) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10"><section className="w-full max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
      <h1 className="text-2xl font-semibold text-slate-950">Confirma tu correo</h1>
      <p role="status" className="text-sm leading-6 text-slate-700">Abre el enlace de confirmación que enviamos. La empresa se creará cuando regreses con una sesión autenticada y el correo confirmado.</p>
      <Link href="/login" className="inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white">Iniciar sesión después de confirmar</Link>
    </section></main>;
  }

  const fullName = typeof auth.user.user_metadata?.full_name === "string" ? auth.user.user_metadata.full_name : "";
  return <main className="readable-interface flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
    <section className="w-full max-w-xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-9">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-blue-700">Asistencia QR</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Completar alta de empresa</h1>
        <p className="mt-2 text-base leading-6 text-slate-600">Tu correo ya está confirmado. Registra tu primera empresa; tu identidad recibirá la membresía Owner desde el servidor.</p>
      </header>
      <FirstCompanyCompletionForm fullName={fullName} />
    </section>
  </main>;
}
