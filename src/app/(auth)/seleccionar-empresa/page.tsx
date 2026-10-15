import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { chooseMembership } from "./actions";

const roleLabels: Record<string, string> = { owner: "Propietario", admin: "Administrador", supervisor: "Supervisor", employee: "Empleado" };

export default async function SelectCompanyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: errorCode } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: memberships, error } = await supabase.from("company_memberships")
    .select("id,company_id,role").eq("user_id", auth.user.id).eq("active", true);
  if (error) redirect("/login?error=service");
  if (!memberships?.length) redirect("/login?error=no-company");
  if (memberships.length === 1) redirect(memberships[0].role === "owner" || memberships[0].role === "admin" ? "/admin" : memberships[0].role === "supervisor" ? "/scanner" : "/mi-qr");
  const { data: companies, error: companyError } = await supabase.from("companies").select("id,name").in("id", memberships.map((item) => item.company_id));
  if (companyError) redirect("/login?error=service");
  const names = new Map((companies ?? []).map((company) => [company.id, company.name]));
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
    <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-9">
      <p className="text-xs font-semibold uppercase tracking-[.15em] text-blue-700">Asistencia QR</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-950">Elige empresa y rol</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">Tu cuenta tiene más de una membresía activa. Elige explícitamente con qué empresa quieres continuar.</p>
      {errorCode ? <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">La opción dejó de estar disponible. Actualiza la página e inténtalo de nuevo.</p> : null}
      <div className="mt-6 space-y-3">{memberships.map((membership) => <form key={membership.id} action={chooseMembership}>
        <input type="hidden" name="membershipId" value={membership.id} />
        <button className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <span><span className="block font-semibold text-slate-900">{names.get(membership.company_id) ?? "Empresa"}</span><span className="mt-1 block text-xs text-slate-500">{roleLabels[membership.role] ?? "Membresía"}</span></span>
          <span className="text-sm font-semibold text-blue-700">Continuar →</span>
        </button>
      </form>)}</div>
    </section>
  </main>;
}
