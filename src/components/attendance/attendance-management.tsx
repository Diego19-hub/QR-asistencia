"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Clock3, LoaderCircle, RefreshCw } from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";
import { dateInTimeZone, formatInTimeZone } from "@/lib/datetime";

type Branch = { id: string; name: string; timezone: string };
type AttendanceItem = {
  session_id: string; employee_id: string; local_work_date: string; timezone: string;
  scheduled_minutes: number | null; presence_minutes: number; all_break_minutes: number;
  non_work_break_minutes: number; effective_work_minutes: number; schedule_delta_minutes: number | null;
  lateness_minutes: number | null; early_departure_minutes: number | null; detected_overtime_minutes: number | null;
  status: "open" | "closed"; startedAt: string; endedAt: string | null; scheduledStartAt: string | null; scheduledEndAt: string | null;
  branchName: string; branchTimezone: string; hasIncompleteBreaks: boolean;
  classification: "open" | "incomplete" | "unscheduled" | "closed";
  employee: { id: string; employeeNumber: string; name: string };
};
type Payload = { from: string; to: string; branches: Branch[]; items: AttendanceItem[]; truncated: boolean; error?: { message?: string }; summary: { sessions: number; open: number; incomplete: number; unscheduled: number; presenceMinutes: number; effectiveMinutes: number } };

const today = () => dateInTimeZone(new Date(), "America/Mexico_City");
const earlier = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() - days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};
const duration = (value: number | null) => value === null ? "—" : `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, "0")} min`;
const clock = (value: string | null, timezone: string) => value ? formatInTimeZone(value, timezone) : "—";
const shortTime = (value: string | null, timezone: string) => value ? new Intl.DateTimeFormat("es-MX", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const statusText = { open: "Abierta", incomplete: "Incompleta", unscheduled: "Sin horario", closed: "Cerrada" };
const statusStyle = { open: "bg-blue-50 text-blue-700", incomplete: "bg-amber-50 text-amber-800", unscheduled: "bg-slate-100 text-slate-600", closed: "bg-emerald-50 text-emerald-700" };
const inputClass = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100";

export function AttendanceManagement() {
  const { company } = useAdminContext();
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(earlier(today(), 29));
  const [branchId, setBranchId] = useState("");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadedUrl, setLoadedUrl] = useState("");
  const [error, setError] = useState("");
  const params = new URLSearchParams({ companyId: company.companyId, from, to });
  if (branchId) params.set("branchId", branchId);
  const requestUrl = `/api/attendance?${params}`;
  const loading = loadedUrl !== requestUrl;
  const data = loadedUrl === requestUrl ? payload : null;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(requestUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as Payload;
        if (!response.ok) throw new Error(body.error?.message ?? "No fue posible cargar las asistencias.");
        setPayload(body); setError(""); setLoadedUrl(requestUrl);
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "No fue posible cargar las asistencias."); setLoadedUrl(requestUrl); } });
    return () => controller.abort();
  }, [requestUrl]);

  const totals = data?.summary;
  return <section className="space-y-6">
    <header><p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Control de jornada</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Asistencias</h1><p className="mt-1 text-sm text-slate-500">Tiempos calculados por fecha laboral y sucursal, usando la zona horaria registrada en cada jornada.</p></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[{ label: "Jornadas", value: totals?.sessions ?? "—" }, { label: "En curso", value: totals?.open ?? "—" }, { label: "Tiempo efectivo", value: totals ? duration(totals.effectiveMinutes) : "—" }, { label: "Con incidencias", value: totals ? totals.incomplete + totals.unscheduled : "—" }].map((item) => <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{item.label}</p><p className="mt-2 text-xl font-bold text-slate-950">{item.value}</p></article>)}
    </div>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-slate-600">Desde<input aria-label="Fecha desde" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className={`${inputClass} mt-1 block`} /></label><label className="text-xs font-semibold text-slate-600">Hasta<input aria-label="Fecha hasta" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className={`${inputClass} mt-1 block`} /></label><label className="text-xs font-semibold text-slate-600">Sucursal<select aria-label="Filtrar por sucursal" value={branchId} onChange={(event) => setBranchId(event.target.value)} className={`${inputClass} mt-1 block`}><option value="">Todas las sucursales</option>{(data?.branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label></div>
        <span className="inline-flex items-center gap-2 text-xs text-slate-500">{loading ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={14} />}{loading ? "Actualizando…" : `${data?.items.length ?? 0} registros`}</span>
      </div>
      {error ? <p role="alert" className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
      {data?.truncated ? <p className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-3 text-xs text-amber-900"><AlertTriangle size={15} />Se muestran las primeras 500 jornadas. Reduce el rango para consultar más detalle.</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1450px] text-left"><thead><tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">{["Empleado · fecha", "Sucursal · estado", "Horario esperado", "Registro real", "Presencia", "Descansos", "Efectivo", "Diferencia", "Retardo", "Salida anticipada", "Excedente detectado"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{(data?.items ?? []).map((item) => <tr key={item.session_id} className="align-top text-xs hover:bg-slate-50/70"><td className="px-4 py-4"><p className="font-semibold text-slate-800">{item.employee.name}</p><p className="mt-1 text-[11px] text-slate-500">{item.employee.employeeNumber} · {new Date(`${item.local_work_date}T12:00:00Z`).toLocaleDateString("es-MX", { dateStyle: "medium", timeZone: item.branchTimezone })}</p></td>
            <td className="px-4 py-4"><p className="text-slate-700">{item.branchName}</p><span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${statusStyle[item.classification]}`}>{statusText[item.classification]}</span>{item.hasIncompleteBreaks ? <p className="mt-1 text-[10px] text-amber-800">Descanso incompleto</p> : null}</td>
            <td className="px-4 py-4"><p>{item.scheduled_minutes === null ? "Sin turno programado" : `${shortTime(item.scheduledStartAt, item.branchTimezone)}–${shortTime(item.scheduledEndAt, item.branchTimezone)}`}</p><p className="mt-1 text-[10px] text-slate-500">{duration(item.scheduled_minutes)}</p></td>
            <td className="px-4 py-4"><p>{shortTime(item.startedAt, item.branchTimezone)}–{shortTime(item.endedAt, item.branchTimezone)}</p><p className="mt-1 text-[10px] text-slate-500">{item.endedAt ? clock(item.startedAt, item.branchTimezone) : "Entrada registrada; jornada abierta"}</p></td>
            <td className="px-4 py-4 font-medium">{duration(item.presence_minutes)}</td><td className="px-4 py-4"><p>{duration(item.all_break_minutes)} total</p><p className="mt-1 text-[10px] text-slate-500">{duration(item.non_work_break_minutes)} no computable</p></td>
            <td className="px-4 py-4 font-semibold text-slate-900">{duration(item.effective_work_minutes)}</td><td className="px-4 py-4">{item.schedule_delta_minutes === null ? "—" : `${item.schedule_delta_minutes > 0 ? "+" : ""}${duration(item.schedule_delta_minutes)}`}</td>
            <td className="px-4 py-4">{duration(item.lateness_minutes)}</td><td className="px-4 py-4">{duration(item.early_departure_minutes)}</td><td className="px-4 py-4">{item.detected_overtime_minutes === null ? "—" : duration(item.detected_overtime_minutes)}</td></tr>)}
            {!loading && !error && !data?.items.length ? <tr><td colSpan={11} className="px-5 py-14 text-center"><CalendarDays className="mx-auto text-slate-300" size={24} /><p className="mt-3 text-sm font-semibold text-slate-700">No hay jornadas en este rango</p><p className="mt-1 text-xs text-slate-500">Prueba otras fechas o selecciona todas las sucursales.</p></td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500"><Clock3 size={14} />El excedente detectado es informativo; no representa horas extra autorizadas.</p>
    </section>
  </section>;
}
