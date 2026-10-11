"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, CircleAlert, Clock3, Coffee, UserRoundCheck, Users } from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";
import { formatInTimeZone } from "@/lib/datetime";

type DashboardData = {
  branches: { id: string; name: string; timezone: string }[];
  stats: { activeEmployees: number; openShifts: number; onBreak: number; completedToday: number; incidents: number };
  movements: { id: string; employee: string; branch: string; type: string; occurredAt: string; timezone: string; status: string }[];
};

const statsConfig = [
  { key: "activeEmployees", label: "Empleados activos", icon: Users, color: "bg-blue-50 text-blue-700", detail: "En el padrón de la empresa" },
  { key: "openShifts", label: "Jornadas abiertas", icon: Activity, color: "bg-indigo-50 text-indigo-700", detail: "Empleados con jornada iniciada" },
  { key: "onBreak", label: "En descanso", icon: Coffee, color: "bg-amber-50 text-amber-700", detail: "Descanso sin cierre registrado" },
  { key: "completedToday", label: "Jornadas completadas", icon: UserRoundCheck, color: "bg-emerald-50 text-emerald-700", detail: "Según la fecha local de cada sucursal" },
  { key: "incidents", label: "Incidencias", icon: CircleAlert, color: "bg-rose-50 text-rose-700", detail: "Descansos incompletos o jornadas abiertas anteriores" },
] as const;

export function Dashboard() {
  const { company } = useAdminContext();
  const [branchFilter, setBranchFilter] = useState({ companyId: company.companyId, branchId: "" });
  const branchId = branchFilter.companyId === company.companyId ? branchFilter.branchId : "";
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const requestKey = `${company.companyId}:${branchId}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ companyId: company.companyId });
    if (branchId) query.set("branchId", branchId);
    fetch(`/api/dashboard/summary?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "No fue posible cargar el dashboard.");
        return payload as DashboardData;
      })
      .then((payload) => { setData(payload); setError(""); setLoadedKey(requestKey); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado."); setLoadedKey(requestKey); } });
    return () => controller.abort();
  }, [branchId, company.companyId, requestKey]);

  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Resumen general</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Buen día</h1><p className="mt-1 text-sm text-slate-500">Actividad y operación de <span className="font-semibold text-slate-700">{company.companyName}</span>.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {!loading && data?.branches.length && data.branches.length > 1 ? <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-500">Sucursal<select value={branchId} onChange={(event) => setBranchFilter({ companyId: company.companyId, branchId: event.target.value })} className="max-w-48 bg-transparent font-semibold text-slate-800 outline-none"><option value="">Todas las sucursales</option>{data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
        <Link href="/admin/empleados" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-900">Ver empleados<ArrowRight size={15} /></Link>
      </div>
    </section>

    {error ? <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><CircleAlert className="mt-0.5 shrink-0" size={17} /><div><p className="font-semibold">No se pudo cargar la información</p><p className="mt-1 text-rose-700">{error}</p></div></div> : null}

    <section aria-label="Indicadores de asistencia" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {statsConfig.map(({ key, label, icon: Icon, color, detail }) => <article key={key} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_12px_rgba(24,39,75,.035)]">
        <div className="flex items-start justify-between"><span className={`grid size-10 place-items-center rounded-xl ${color}`}><Icon size={19} /></span>{key === "incidents" ? <ArrowUpRight className="text-slate-300" size={16} /> : <ArrowDownRight className="text-slate-300" size={16} />}</div>
        <p className="mt-5 text-[27px] font-bold leading-none tracking-tight text-slate-950">{loading ? <span className="inline-block h-7 w-12 animate-pulse rounded-md bg-slate-100" /> : data?.stats[key] ?? 0}</p>
        <h2 className="mt-2 text-sm font-semibold text-slate-700">{label}</h2><p className="mt-1 text-[11px] leading-relaxed text-slate-400">{detail}</p>
      </article>)}
    </section>

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,.75fr)]">
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(24,39,75,.035)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6"><div><h2 className="text-sm font-bold text-slate-900">Movimientos recientes</h2><p className="mt-1 text-xs text-slate-400">Últimos registros recibidos</p></div><Link href="/admin/asistencias" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900">Ver asistencias<ArrowRight size={14} /></Link></div>
        {loading ? <div className="space-y-4 p-6">{[0, 1, 2, 3].map((i) => <div className="h-10 animate-pulse rounded-lg bg-slate-50" key={i} />)}</div> : data?.movements.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left"><thead><tr className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-[.1em] text-slate-400"><th className="px-6 py-3">Empleado</th><th className="px-4 py-3">Movimiento</th><th className="px-4 py-3">Fecha y hora</th><th className="px-6 py-3">Jornada</th></tr></thead><tbody className="divide-y divide-slate-100">{data.movements.map((movement) => <tr key={movement.id} className="text-xs"><td className="px-6 py-4"><p className="font-semibold text-slate-800">{movement.employee}</p><p className="mt-1 text-[11px] text-slate-400">{movement.branch}</p></td><td className="px-4 py-4"><span className="inline-flex rounded-lg bg-blue-50 px-2.5 py-1.5 font-semibold text-blue-800">{movement.type}</span></td><td className="px-4 py-4 text-slate-500">{formatInTimeZone(movement.occurredAt, movement.timezone)}</td><td className="px-6 py-4"><span className={`inline-flex items-center gap-1.5 font-medium ${movement.status === "open" ? "text-amber-700" : "text-emerald-700"}`}><span className={`size-1.5 rounded-full ${movement.status === "open" ? "bg-amber-500" : "bg-emerald-500"}`} />{movement.status === "open" ? "En curso" : "Completada"}</span></td></tr>)}</tbody></table></div> : <div className="px-6 py-12 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-50 text-slate-400"><Clock3 size={21} /></div><p className="mt-4 text-sm font-semibold text-slate-800">Aún no hay movimientos</p><p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">Cuando se registren asistencias, los movimientos más recientes aparecerán aquí.</p><Link href="/admin/empleados" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">Registrar primer empleado<ArrowRight size={14} /></Link></div>}
      </div>
      <aside className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_12px_rgba(24,39,75,.035)] sm:p-6"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Activity size={18} /></span><div><h2 className="text-sm font-bold text-slate-900">Accesos rápidos</h2><p className="mt-1 text-xs text-slate-400">Tareas administrativas</p></div></div><div className="mt-5 space-y-2.5">
        <Link href="/admin/empleados" className="group flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3.5 transition hover:border-blue-200 hover:bg-blue-50/40"><span><span className="block text-xs font-semibold text-slate-800">Gestionar empleados</span><span className="mt-1 block text-[11px] text-slate-400">Expedientes y estado laboral</span></span><ArrowRight size={15} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-700" /></Link>
        <Link href="/admin/horarios" className="group flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3.5 transition hover:border-blue-200 hover:bg-blue-50/40"><span><span className="block text-xs font-semibold text-slate-800">Consultar horarios</span><span className="mt-1 block text-[11px] text-slate-400">Plantillas y asignaciones</span></span><ArrowRight size={15} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-700" /></Link>
        <Link href="/admin/reportes" className="group flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3.5 transition hover:border-blue-200 hover:bg-blue-50/40"><span><span className="block text-xs font-semibold text-slate-800">Ir a reportes</span><span className="mt-1 block text-[11px] text-slate-400">Resumen de operación</span></span><ArrowRight size={15} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-700" /></Link>
      </div><p className="mt-5 rounded-xl bg-slate-50 px-3.5 py-3 text-[11px] leading-relaxed text-slate-500">El sistema no marca ausencias sin una asignación de turno vigente.</p></aside>
    </section>
  </div>;
}
