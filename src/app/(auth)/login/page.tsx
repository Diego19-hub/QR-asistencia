import { signIn } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

const errorMessages: Record<string, string> = {
  invalid: "Escribe tu correo y contraseña.",
  credentials: "No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo.",
  service: "No fue posible conectar con el servicio de autenticación. Inténtalo más tarde.",
  "no-company": "Tu cuenta aún no está asignada a una empresa. Contacta al administrador.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const message = error ? errorMessages[error] : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
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

          {message ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-800">
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-600/25"
          >
            Entrar
          </button>
        </form>

        <p className="mt-8 text-center text-xs leading-5 text-slate-500">
          Si no tienes acceso, solicita una cuenta al administrador de tu empresa.
        </p>
      </section>
    </main>
  );
}
