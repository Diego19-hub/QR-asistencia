"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CircleDollarSign, LoaderCircle, RefreshCw } from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";
import { dateInTimeZone } from "@/lib/datetime";
type Authorization = { id: string; minutes: number; status: string; reason: string; requested_at: string; decided_at: string | null };
type Item = {
  session_id: string; local_work_date: string; scheduled_minutes: number | null; effective_work_minutes: number;
  detectedMinutes: number; requestedMinutes: number; approvedMinutes: number; pendingMinutes: number; recognizedMinutes: number;
  status: string; timezone: string | null; startedAt: string | null; endedAt: string | null; scheduledStartAt: string | null; scheduledEndAt: string | null;
  hasIncompleteBreaks: boolean;
  branch: { id: string; name: string; timezone: string } | null;
  employee: { name: string; employeeNumber: string } | null; authorizations: Authorization[]; ruleName: string | null;
  overtimeSettings: { thresholdMinutes?: number; recognitionPolicy?: string; detectionEnabled?: boolean } | null;
};
type Payload = { from: string; to: string; items: Item[]; error?: { message?: string }; summary: { sessions: number; detectedMinutes: number; requestedMinutes: number; approvedMinutes: number; pendingMinutes: number } };

const today = () => dateInTimeZone(new Date(), "America/Mexico_City");
const earlier = (date: string, days: number) => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() - days); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; };
const duration = (minutes: number | null) => minutes === null ? "—" : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
const inputClass = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100";
const authStatus: Record<string, string> = { pending: "Pendiente", approved: "Autorizada", rejected: "Rechazada", cancelled: "Cancelada" };

export function OvertimeManagement() {
  const { company } = useAdminContext();
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(earlier(today(), 29));
  const [request, setRequest] = useState<{ key: string; status: "loading" } | { key: string; status: "success"; data: Payload } | { key: string; status: "error"; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const params = new URLSearchParams({ companyId: company.companyId, from, to });
  const requestUrl = `/api/schedules/overtime?${params}`;
  const currentRequest = request?.key === requestUrl ? request : null;
  const loading = !currentRequest || currentRequest.status === "loading";
  const data = currentRequest?.status === "success" ? currentRequest.data : null;
  const error = currentRequest?.status === "error" ? currentRequest.message : "";

  useEffect(() => {
    const controller = new AbortController();
    void fetch(requestUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as Payload;
        if (!response.ok) throw new Error(body.error?.message ?? "No fue posible cargar los excedentes detectados.");
        setRequest({ key: requestUrl, status: "success", data: body });
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setRequest({ key: requestUrl, status: "error", message: reason instanceof Error ? reason.message : "No fue posible cargar los excedentes detectados." }); });
    return () => controller.abort();
  }, [requestUrl, retry]);

  const summary = data?.summary;
  return <section className="space-y-6">
    <header><p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Control de jornada</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Horas extra</h1><p className="mt-1 text-sm text-slate-500">Consulta el tiempo excedente, las solicitudes y el tiempo autorizado como métricas independientes.</p></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      { label: "Tiempo excedente detectado", value: summary ? duration(summary.detectedMinutes) : "—" },
      { label: "Tiempo solicitado", value: summary ? duration(summary.requestedMinutes) : "—" },
      { label: "Tiempo autorizado", value: summary ? duration(summary.approvedMinutes) : "—" },
      { label: "Solicitudes pendientes", value: summary ? `${duration(summary.pendingMinutes)} · ${data?.items.reduce((count, item) => count + item.authorizations.filter((auth) => auth.status === "pending").length, 0)}` : "—" },
    ].map((item) => <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{item.label}</p><p className="mt-2 text-lg font-bold text-slate-950">{item.value}</p></article>)}</div>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5"><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-slate-600">Desde<input aria-label="Fecha desde" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className={`${inputClass} mt-1 block`} /></label><label className="text-xs font-semibold text-slate-600">Hasta<input aria-label="Fecha hasta" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className={`${inputClass} mt-1 block`} /></label></div><span className="inline-flex items-center gap-2 text-xs text-slate-500">{loading ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={14} />}{loading ? "Actualizando…" : `${data?.items.length ?? 0} jornadas`}</span></div>
      {error ? <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><span>{error}</span><button type="button" onClick={() => { setRequest({ key: requestUrl, status: "loading" }); setRetry((value) => value + 1); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold"><RefreshCw size={14} />Reintentar</button></div> : null}
      {!loading && !error && !data?.items.length ? <div className="px-5 py-14 text-center lg:hidden"><CircleDollarSign className="mx-auto text-slate-300" size={25} /><p className="mt-3 text-sm font-semibold text-slate-700">No hay excedentes en este rango</p><p className="mt-1 text-xs text-slate-500">El excedente requiere un turno programado. Las autorizaciones se consultan por separado.</p></div> : null}
      <div className="space-y-3 p-3 lg:hidden">{(data?.items ?? []).map((item) => <article key={item.session_id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-900">{item.employee?.name ?? "Empleado"}</h3><p className="mt-1 text-xs text-slate-500">{item.employee?.employeeNumber ?? "—"} · {item.local_work_date}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${item.hasIncompleteBreaks ? "bg-amber-50 text-amber-800" : item.status === "open" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}>{item.hasIncompleteBreaks ? "Incompleta" : item.status === "open" ? "En curso" : "Cerrada"}</span></div><p className="mt-1 text-xs text-slate-500">{item.branch?.name ?? "Sucursal"} · {item.scheduled_minutes === null ? "Sin horario programado" : `Programado: ${duration(item.scheduled_minutes)}`}</p><div className="mt-3 grid grid-cols-2 gap-2">{[{ label: "Excedente detectado", value: duration(item.detectedMinutes), tone: "text-amber-800" }, { label: "Autorizado", value: duration(item.approvedMinutes), tone: "text-emerald-700" }, { label: "Pendiente", value: duration(item.pendingMinutes), tone: "text-amber-800" }, { label: "Tiempo efectivo", value: duration(item.effective_work_minutes), tone: "text-slate-800" }].map((metric) => <div key={metric.label} className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] text-slate-500">{metric.label}</p><p className={`mt-1 text-xs font-semibold ${metric.tone}`}>{metric.value}</p></div>)}</div><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-blue-800">Solicitudes ({item.authorizations.length})</summary><div className="mt-2 space-y-2">{item.authorizations.length ? item.authorizations.map((auth) => <div key={auth.id} className="rounded-lg border border-slate-100 p-3 text-xs"><span className="font-semibold text-slate-700">{authStatus[auth.status] ?? auth.status}</span><p className="mt-1 text-slate-500">{auth.reason} · {duration(auth.minutes)}</p></div>) : <p className="text-xs text-slate-500">Sin solicitudes registradas.</p>}</div></details></article>)}</div>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[1100px] text-left"><thead><tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">{["Empleado · fecha", "Sucursal · estado", "Jornada", "Efectivo / programado", "Excedente detectado", "Solicitado", "Pendiente", "Autorizado", "Reconocido", "Solicitudes"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{(data?.items ?? []).map((item) => <tr key={item.session_id} className="align-top text-xs hover:bg-slate-50/70"><td className="px-4 py-4"><p className="font-semibold text-slate-800">{item.employee?.name ?? "Empleado"}</p><p className="mt-1 text-[11px] text-slate-500">{item.employee?.employeeNumber ?? "—"} · {new Date(`${item.local_work_date}T12:00:00Z`).toLocaleDateString("es-MX", { dateStyle: "medium", timeZone: item.timezone ?? "UTC" })}</p></td>
          <td className="px-4 py-4"><p>{item.branch?.name ?? "Sucursal"}</p><p className={`mt-1 text-[10px] ${item.hasIncompleteBreaks ? "font-semibold text-amber-800" : "text-slate-500"}`}>{item.hasIncompleteBreaks ? "Incompleta" : item.status === "open" ? "En curso" : "Cerrada"}</p></td>
          <td className="px-4 py-4"><p>{item.scheduled_minutes === null ? "Sin horario programado" : `${item.scheduled_minutes} min`}</p><p className="mt-1 text-[10px] text-slate-500">{item.ruleName ?? "Sin regla laboral"}{item.overtimeSettings?.thresholdMinutes ? ` · umbral ${item.overtimeSettings.thresholdMinutes} min` : ""}</p></td>
          <td className="px-4 py-4"><p className="font-medium">{duration(item.effective_work_minutes)}</p><p className="mt-1 text-[10px] text-slate-500">programado: {duration(item.scheduled_minutes)}</p></td>
          <td className="px-4 py-4 font-semibold text-amber-800">{duration(item.detectedMinutes)}</td><td className="px-4 py-4">{duration(item.requestedMinutes)}</td><td className="px-4 py-4">{duration(item.pendingMinutes)}</td><td className="px-4 py-4 font-semibold text-emerald-700">{duration(item.approvedMinutes)}</td><td className="px-4 py-4">{duration(item.recognizedMinutes)}</td>
          <td className="px-4 py-4"><div className="space-y-2">{item.authorizations.length ? item.authorizations.map((auth) => <div key={auth.id} className="max-w-64 rounded-lg border border-slate-100 p-2"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${auth.status === "approved" ? "bg-emerald-50 text-emerald-700" : auth.status === "pending" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{authStatus[auth.status] ?? auth.status}</span><p className="mt-2 line-clamp-2 text-[11px] text-slate-600">{auth.reason}</p><p className="mt-1 text-[10px] text-slate-400">{duration(auth.minutes)}</p></div>) : <span className="text-[11px] text-slate-400">Sin solicitudes</span>}</div></td></tr>)}
          {!loading && !error && !data?.items.length ? <tr><td colSpan={10} className="px-5 py-14 text-center"><CircleDollarSign className="mx-auto text-slate-300" size={25} /><p className="mt-3 text-sm font-semibold text-slate-700">No hay excedentes en este rango</p><p className="mt-1 text-xs text-slate-500">El excedente requiere un turno con minutos programados; se mantienen separados los días sin horario.</p></td></tr> : null}</tbody>
      </table></div>
      <p className="flex items-start gap-2 border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-500"><AlertCircle className="mt-0.5 shrink-0" size={14} />El tiempo detectado no se autoriza automáticamente. Esta vista presenta las solicitudes y decisiones existentes; no altera los registros ni sustituye reglas laborales.</p>
    </section>
  </section>;
}
