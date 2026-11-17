import { signIn } from "./actions";
import Link from "next/link";
import { accessReturnDestination, companySelectionPathForAccessDestination, destinationForAccessRole } from "@/lib/access/access-links";
import { selectInitialMembership, type MembershipRole } from "@/lib/access/user-management";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; next?: string; confirmed?: string }>;
};

const errorMessages: Record<string, string> = {
  invalid: "Escribe tu correo y contraseña.",
  credentials: "No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo.",
  service: "No fue posible conectar con el servicio de autenticación. Inténtalo más tarde.",
  "no-company": "Tu cuenta aún no está asignada a una empresa. Si quieres crear la primera, usa “Crear empresa”.",
  invite: "No fue posible validar el enlace de invitación. Solicita que lo reenvíen.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, next: requestedNext, confirmed } = await searchParams;
  const next = accessReturnDestination(requestedNext);
  const message = error ? errorMessages[error] : undefined;

  // Reopen an existing authenticated session directly in its valid role.
  // A pending invitation still takes priority, and a multi-company account
  // keeps the explicit company-selection step unless its prior selection is
  // still an active membership belonging to this user.
  if (!message) {
    try {
      const supabase = await createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!authError && auth.user) {
        if (next === "/invitacion/compartida") redirect(next);

        const { data: memberships, error: membershipError } = await supabase.from("company_memberships")
          .select("id,company_id,role").eq("user_id", auth.user.id).eq("active", true);
        if (membershipError) redirect("/login?error=service");

        const { data: pending, error: invitationError } = await supabase.rpc("list_my_pending_company_invitations");
        const missingInvitationFunction = invitationError?.code === "PGRST202" || invitationError?.code === "42883";
        if (invitationError && !missingInvitationFunction) redirect("/login?error=service");
        if (Array.isArray(pending) && pending.length) redirect("/invitacion");

        const choices = (memberships ?? []).map((membership) => ({
          companyId: membership.company_id,
          role: membership.role as MembershipRole,
          membershipId: membership.id,
        }));
        const selectedId = (await cookies()).get("qr_active_membership_id")?.value;
        const selected = selectInitialMembership(choices, selectedId);
        if (selected.kind === "none") redirect("/crear-empresa");
        if (selected.kind === "choose") redirect(companySelectionPathForAccessDestination(next));
        redirect(destinationForAccessRole(selected.membership.role, next));
      }
    } catch (caught) {
      // Next redirect() throws a control-flow exception; rethrow it unchanged.
      if (caught && typeof caught === "object" && "digest" in caught) throw caught;
      // Keep the login form usable during a transient Auth lookup failure.
    }
  }

  return (
    <main className="readable-interface flex min-h-screen items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 sm:p-10">
        <div className="mb-8">
          <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-blue-700 text-lg font-bold text-white">
            QR
          </div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
            Asistencia QR
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            Iniciar sesión
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Accede con el correo y la contraseña de tu cuenta de trabajo.
          </p>
        </div>

        <form action={signIn} className="space-y-5">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-800">
              Correo electrónico
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="w-full rounded-lg border border-slate-300 px-3.5 py-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              placeholder="nombre@empresa.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-800">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-slate-300 px-3.5 py-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              placeholder="Tu contraseña"
            />
          </div>

          <label htmlFor="rememberSession" className="flex items-start gap-3 text-sm leading-5 text-slate-700">
            <input
              id="rememberSession"
              name="rememberSession"
              type="checkbox"
              className="mt-0.5 size-4 rounded border-slate-300 text-blue-700 focus:ring-2 focus:ring-blue-600/30"
            />
            <span>
              <span className="block font-medium text-slate-800">Mantener sesión iniciada en este dispositivo</span>
              <span className="mt-1 block text-slate-600">En dispositivos compartidos, deja esta opción desactivada.</span>
            </span>
          </label>

          {message ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-800">
              {message}
            </p>
          ) : null}

          {confirmed ? (
            <p role="status" className="rounded-lg bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">
              Correo confirmado. Inicia sesión para completar la creación de tu empresa.
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-600/25"
          >
            Entrar
          </button>
        </form>

        <p className="mt-6 text-center text-sm leading-6 text-slate-600">
          ¿No tienes empresa? <Link href="/crear-empresa" className="font-semibold text-blue-700 underline underline-offset-2">Crear empresa</Link>
        </p>
        <p className="mt-3 text-center text-xs leading-5 text-slate-500">
          Si ya perteneces a una empresa, solicita acceso a su administrador.
        </p>
      </section>
    </main>
  );
}
