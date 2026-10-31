"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity, ArrowRight, CalendarClock, ChartNoAxesCombined, CircleAlert, Clock3,
  Coffee, RotateCw, UserRoundCheck, Users,
} from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";
import { formatInTimeZone } from "@/lib/datetime";

type DashboardData = {
  company: { id: string; name: string };
  operatingDate: string;
  dateReference: string;
  branches: { id: string; name: string; timezone: string }[];
  stats: { activeEmployees: number; openShifts: number; onBreak: number; completedToday: number; incidents: number };
  movements: { id: string; employee: string; branch: string; type: string; occurredAt: string; timezone: string; status: string }[];
};

const statsConfig = [
  { key: "activeEmployees", label: "Empleados activos", icon: Users, color: "bg-blue-50 text-blue-700", detail: "En el padrón de la empresa" },
  { key: "openShifts", label: "Trabajando actualmente", icon: Activity, color: "bg-indigo-50 text-indigo-700", detail: "Jornadas iniciadas y aún abiertas" },
  { key: "onBreak", label: "En descanso", icon: Coffee, color: "bg-amber-50 text-amber-700", detail: "Descanso sin cierre registrado" },
  { key: "completedToday", label: "Jornadas completadas hoy", icon: UserRoundCheck, color: "bg-emerald-50 text-emerald-700", detail: "Según la fecha local de cada sucursal" },
  { key: "incidents", label: "Incidencias por atender", icon: CircleAlert, color: "bg-rose-50 text-rose-700", detail: "Requieren seguimiento administrativo" },
] as const;

const quickLinks = [
  { href: "/admin/empleados", title: "Gestionar empleados", description: "Altas, datos y estado laboral", icon: Users },
  { href: "/admin/horarios", title: "Configurar horarios", description: "Reglas y asignaciones de jornada", icon: CalendarClock },
  { href: "/admin/asistencias", title: "Consultar asistencias", description: "Revisar registros y jornadas", icon: Clock3 },
  { href: "/admin/reportes", title: "Revisar reportes", description: "Consultar y exportar resultados", icon: ChartNoAxesCombined },
];

function MetricValue({ loading, value, unavailable }: { loading: boolean; value?: number; unavailable: boolean }) {
  if (loading) return <span aria-label="Cargando" className="inline-block h-8 w-12 animate-pulse rounded-md bg-slate-100" />;
  if (unavailable || value === undefined) return <span className="text-lg font-semibold text-slate-400">No disponible</span>;
  return <>{value}</>;
}

export function Dashboard() {
  const { company } = useAdminContext();
  const [branchFilter, setBranchFilter] = useState({ companyId: company.companyId, branchId: "" });
  const branchId = branchFilter.companyId === company.companyId ? branchFilter.branchId : "";
  const [data, setData] = useState<DashboardData | null>(null);
  const [branchOptions, setBranchOptions] = useState<{ id: string; name: string; timezone: string }[]>([]);
  const [branchesCompanyId, setBranchesCompanyId] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [loadedCompanyId, setLoadedCompanyId] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const requestKey = `${company.companyId}:${branchId}`;
  const loading = loadedKey !== requestKey;
  const branches = branchesCompanyId === company.companyId ? branchOptions : [];

  const loadDashboard = useCallback((signal: AbortSignal) => {
    const query = new URLSearchParams({ companyId: company.companyId });
    if (branchId) query.set("branchId", branchId);
    return fetch(`/api/dashboard/summary?${query}`, { cache: "no-store", signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "No fue posible cargar el dashboard.");
        return payload as DashboardData;
      });
  }, [branchId, company.companyId]);

  useEffect(() => {
    const controller = new AbortController();
    loadDashboard(controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) {
          setData(payload);
          setError("");
          setBranchOptions(payload.branches);
          setBranchesCompanyId(company.companyId);
          setLoadedCompanyId(company.companyId);
          setLoadedKey(requestKey);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setData(null);
          setLoadedCompanyId(company.companyId);
          setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
          setLoadedKey(requestKey);
        }
      });
    return () => controller.abort();
  }, [company.companyId, loadDashboard, requestKey, retry]);

  const showLoading = loading;
  const failed = !loading && Boolean(error);
  const validData = !loading && !error && loadedCompanyId === company.companyId ? data : null;
  const hasIncidents = (validData?.stats.incidents ?? 0) > 0;

  return <div className="space-y-6 sm:space-y-7">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Panel administrativo</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Resumen de asistencia</h1>
        <p className="mt-1 text-sm text-slate-600"><span className="font-semibold text-slate-800">{company.companyName}</span>{validData ? <><span className="mx-2 text-slate-300">·</span>{new Intl.DateTimeFormat("es-MX", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${validData.operatingDate}T12:00:00Z`))}</> : null}</p>
        {validData ? <p className="mt-1 text-xs text-slate-400">Fecha operativa · {validData.dateReference}{!branchId && branches.length > 0 ? ` · referencia de ${branches[0].name}` : null}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {branches.length > 1 ? <label className="flex h-11 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-600 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100"><span>Sucursal</span><select aria-label="Filtrar por sucursal" value={branchId} onChange={(event) => setBranchFilter({ companyId: company.companyId, branchId: event.target.value })} className="max-w-48 min-w-0 cursor-pointer bg-transparent font-semibold text-slate-800 outline-none"><option value="">Todas las sucursales</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
        <Link href="/admin/empleados" className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">Ver empleados<ArrowRight size={15} /></Link>
      </div>
    </section>

    {failed ? <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 shrink-0" size={18} /><div><p className="font-semibold">No se pudo cargar la información</p><p className="mt-1 text-rose-700">{error}</p></div></div><button type="button" onClick={() => { setLoadedKey(""); setRetry((value) => value + 1); }} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-800 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 sm:self-auto"><RotateCw size={14} />Reintentar</button></div> : null}

    <section aria-label="Indicadores de asistencia" aria-busy={showLoading} className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
      {statsConfig.map(({ key, label, icon: Icon, color, detail }) => <article key={key} className={`min-w-0 rounded-2xl border bg-white p-4 shadow-[0_2px_12px_rgba(24,39,75,.035)] sm:p-5 ${key === "incidents" && hasIncidents ? "border-rose-300 ring-1 ring-rose-100" : "border-slate-200/80"}`}>
        <div className="flex items-start justify-between gap-2"><span className={`grid size-9 shrink-0 place-items-center rounded-xl sm:size-10 ${color}`}><Icon size={19} /></span>{key === "incidents" && hasIncidents ? <span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-800">Atención</span> : null}</div>
        <p className="mt-5 min-h-8 break-words text-2xl font-bold leading-tight tracking-tight text-slate-950 sm:text-[27px]"><MetricValue loading={showLoading} value={validData?.stats[key]} unavailable={failed} /></p>
        <h2 className="mt-2 text-xs font-semibold text-slate-700 sm:text-sm">{label}</h2><p className="mt-1 text-[11px] leading-relaxed text-slate-400">{detail}</p>
      </article>)}
    </section>

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,.75fr)]">
      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(24,39,75,.035)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6"><div><h2 className="text-sm font-bold text-slate-900">Movimientos recientes</h2><p className="mt-1 text-xs text-slate-400">Últimos registros de asistencia</p></div><Link href="/admin/asistencias" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Ver asistencias<ArrowRight size={14} /></Link></div>
        {showLoading ? <div aria-label="Cargando movimientos" className="space-y-4 p-5 sm:p-6">{[0, 1, 2, 3].map((i) => <div className="h-10 animate-pulse rounded-lg bg-slate-50" key={i} />)}</div>
          : failed ? <div className="px-5 py-10 text-center"><CircleAlert className="mx-auto text-rose-500" size={22} /><p className="mt-3 text-sm font-semibold text-slate-800">Movimientos no disponibles</p><p className="mt-1 text-xs text-slate-500">Reintenta la consulta para actualizar esta sección.</p></div>
            : validData?.movements.length ? <>
              <div className="divide-y divide-slate-100 md:hidden">{validData.movements.map((movement) => <article key={movement.id} className="flex min-w-0 items-start justify-between gap-3 px-4 py-4"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{movement.employee}</p><p className="mt-1 truncate text-xs text-slate-500">{movement.branch} · {formatInTimeZone(movement.occurredAt, movement.timezone)}</p><span className="mt-2 inline-flex rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-800">{movement.type}</span></div><span className={`mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium ${movement.status === "open" ? "text-amber-700" : "text-emerald-700"}`}><span className={`size-1.5 rounded-full ${movement.status === "open" ? "bg-amber-500" : "bg-emerald-500"}`} />{movement.status === "open" ? "En curso" : "Completada"}</span></article>)}</div>
              <div className="hidden overflow-x-auto md:block"><table className="w-full text-left"><thead><tr className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-[.1em] text-slate-400"><th scope="col" className="px-6 py-3">Empleado</th><th scope="col" className="px-4 py-3">Movimiento</th><th scope="col" className="px-4 py-3">Fecha y hora</th><th scope="col" className="px-6 py-3">Jornada</th></tr></thead><tbody className="divide-y divide-slate-100">{validData.movements.map((movement) => <tr key={movement.id} className="text-xs transition-colors hover:bg-slate-50/70"><td className="px-6 py-4"><p className="font-semibold text-slate-800">{movement.employee}</p><p className="mt-1 text-[11px] text-slate-400">{movement.branch}</p></td><td className="px-4 py-4"><span className="inline-flex rounded-lg bg-blue-50 px-2.5 py-1.5 font-semibold text-blue-800">{movement.type}</span></td><td className="whitespace-nowrap px-4 py-4 text-slate-500">{formatInTimeZone(movement.occurredAt, movement.timezone)}</td><td className="px-6 py-4"><span className={`inline-flex items-center gap-1.5 font-medium ${movement.status === "open" ? "text-amber-700" : "text-emerald-700"}`}><span className={`size-1.5 rounded-full ${movement.status === "open" ? "bg-amber-500" : "bg-emerald-500"}`} />{movement.status === "open" ? "En curso" : "Completada"}</span></td></tr>)}</tbody></table></div>
            </> : <div className="px-5 py-10 text-center sm:px-6 sm:py-12"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-50 text-slate-400"><Clock3 size={21} /></div><p className="mt-4 text-sm font-semibold text-slate-800">Aún no hay movimientos</p><p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">{validData && validData.stats.activeEmployees > 0 ? "Tus empleados ya pueden registrar su asistencia con el lector QR asignado a su sucursal." : "Registra el primer empleado para comenzar a recibir asistencias."}</p>{validData && validData.stats.activeEmployees === 0 ? <Link href="/admin/empleados" className="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Registrar primer empleado<ArrowRight size={14} /></Link> : null}</div>}
      </div>
      <aside className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_12px_rgba(24,39,75,.035)] sm:p-6"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Activity size={18} /></span><div><h2 className="text-sm font-bold text-slate-900">Accesos rápidos</h2><p className="mt-1 text-xs text-slate-400">Operaciones frecuentes</p></div></div><div className="mt-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">{quickLinks.map(({ href, title, description, icon: Icon }) => <Link key={href} href={href} className="group flex min-h-[68px] items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3 transition hover:border-blue-200 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500 group-hover:bg-white group-hover:text-blue-700"><Icon size={16} /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-800">{title}</span><span className="mt-1 block text-[11px] leading-snug text-slate-400">{description}</span></span><ArrowRight size={15} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-700" /></Link>)}</div><p className="mt-5 rounded-xl bg-slate-50 px-3.5 py-3 text-[11px] leading-relaxed text-slate-500">El sistema no marca ausencias sin una asignación de turno vigente.</p></aside>
    </section>
  </div>;
}
