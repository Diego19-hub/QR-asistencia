"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarDays, Check, Clock3, LoaderCircle, RefreshCw, Search } from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";
import { dateInTimeZone, formatInTimeZone } from "@/lib/datetime";
import { getAttendanceStatus } from "@/lib/attendance/presentation";

type Branch = { id: string; name: string; timezone: string };
type EmployeeOption = { id: string; employeeNumber: string; name: string; branchId: string | null };
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
type Filters = { from: string; to: string; branchId: string; employeeId: string; status: string };
type Payload = { from: string; to: string; branches: Branch[]; employees: EmployeeOption[]; items: AttendanceItem[]; truncated: boolean; error?: { message?: string }; summary: { sessions: number; employees: number; open: number; closed: number; incomplete: number; unscheduled: number; incidents: number; presenceMinutes: number; effectiveMinutes: number } };
type Detail = {
  session: { id: string; local_work_date: string; timezone: string; status: "open" | "closed"; started_at: string; ended_at: string | null; scheduled_start_at: string | null; scheduled_end_at: string | null };
  employee: { id: string; employeeNumber: string; name: string };
  branch: { id: string; name: string; timezone: string };
  totals: { scheduled_minutes: number | null; presence_minutes: number; all_break_minutes: number; non_work_break_minutes: number; effective_work_minutes: number; schedule_delta_minutes: number | null; lateness_minutes: number | null; early_departure_minutes: number | null; detected_overtime_minutes: number | null; has_incomplete_breaks: boolean };
  events: Array<{ id: string; event_type: string; occurred_at: string; sequence_no: number }>;
  breaks: Array<{ id: string; started_at: string | null; ended_at: string | null; counts_as_work: boolean; is_incomplete: boolean; rule: { name: string; code: string } | null }>;
};
type AttendanceRequest = { key: string; status: "loading" } | { key: string; status: "success"; data: Payload } | { key: string; status: "error"; message: string };
type DetailRequest = { key: string; status: "loading" } | { key: string; status: "success"; data: Detail } | { key: string; status: "error"; message: string };
const duration = (value: number | null | undefined) => value == null ? "—" : `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, "0")} min`;
const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100";
const statusText = { open: "En curso", incomplete: "Descanso incompleto", unscheduled: "Sin horario programado", closed: "Terminada" };
const statusStyle = { open: "bg-blue-50 text-blue-700", incomplete: "bg-amber-50 text-amber-800", unscheduled: "bg-slate-100 text-slate-700", closed: "bg-emerald-50 text-emerald-700" };
const eventText: Record<string, string> = { clock_in: "Entrada", break_start: "Inicio del descanso", break_end: "Fin del descanso", clock_out: "Salida" };
const today = () => dateInTimeZone(new Date(), "America/Mexico_City");
const moveDate = (date: string, amount: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); };
function initialFilters(search: URLSearchParams): Filters {
  const date = today();
  return { from: search.get("from") ?? moveDate(date, -29), to: search.get("to") ?? date, branchId: search.get("branchId") ?? "", employeeId: search.get("employeeId") ?? "", status: search.get("status") ?? "all" };
}
function classify(item: AttendanceItem) { return statusText[getAttendanceStatus({ status: item.status, incompleteBreaks: item.hasIncompleteBreaks, scheduledMinutes: item.scheduled_minutes })]; }

export function AttendanceManagement() {
  const { company } = useAdminContext();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const serializedSearch = searchParams.toString();
  const [filters, setFilters] = useState<Filters>(() => initialFilters(new URLSearchParams(serializedSearch)));
  const [applied, setApplied] = useState<Filters>(() => initialFilters(new URLSearchParams(serializedSearch)));
  const [request, setRequest] = useState<AttendanceRequest | null>(null);
  const [retry, setRetry] = useState(0);
  const [detailId, setDetailId] = useState("");
  const [detailRequest, setDetailRequest] = useState<DetailRequest | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);

  const params = useMemo(() => {
    const value = new URLSearchParams({ companyId: company.companyId, from: applied.from, to: applied.to, status: applied.status });
    if (applied.branchId) value.set("branchId", applied.branchId);
    if (applied.employeeId) value.set("employeeId", applied.employeeId);
    return value;
  }, [applied, company.companyId]);
  const requestUrl = `/api/attendance?${params}`;
  const currentRequest = request?.key === requestUrl ? request : null;
  const data = currentRequest?.status === "success" ? currentRequest.data : null;
  const loading = !currentRequest || currentRequest.status === "loading";
  const error = currentRequest?.status === "error" ? currentRequest.message : "";
  const detailKey = detailId ? `${company.companyId}:${detailId}` : "";
  const currentDetailRequest = detailRequest?.key === detailKey ? detailRequest : null;
  const detail = currentDetailRequest?.status === "success" ? currentDetailRequest.data : null;
  const detailError = currentDetailRequest?.status === "error" ? currentDetailRequest.message : "";
  const detailLoading = Boolean(detailId) && (!currentDetailRequest || currentDetailRequest.status === "loading");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(requestUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as Payload;
        if (!response.ok) throw new Error(body.error?.message ?? "No fue posible cargar las asistencias.");
        if (!controller.signal.aborted) setRequest({ key: requestUrl, status: "success", data: body });
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setRequest({ key: requestUrl, status: "error", message: reason instanceof Error ? reason.message : "No fue posible cargar las asistencias." }); });
    return () => controller.abort();
  }, [requestUrl, retry]);

  useEffect(() => {
    if (!detailId) return;
    const controller = new AbortController();
    void fetch(`/api/attendance/${encodeURIComponent(detailId)}?companyId=${encodeURIComponent(company.companyId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as Detail & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? "No fue posible consultar el detalle.");
        if (!controller.signal.aborted) setDetailRequest({ key: detailKey, status: "success", data: body });
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setDetailRequest({ key: detailKey, status: "error", message: reason instanceof Error ? reason.message : "No fue posible consultar el detalle." }); });
    return () => controller.abort();
  }, [company.companyId, detailId, detailKey, detailRetry]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplied({ ...filters }); setDetailId("");
    const query = new URLSearchParams(serializedSearch);
    for (const key of ["from", "to", "branchId", "employeeId", "status"]) query.delete(key);
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }
  function clearFilters() {
    const date = today(); const fresh = { from: moveDate(date, -29), to: date, branchId: "", employeeId: "", status: "all" };
    setFilters(fresh); setApplied(fresh); setDetailId("");
    const query = new URLSearchParams(serializedSearch);
    for (const key of ["from", "to", "branchId", "employeeId", "status"]) query.delete(key);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }
  function setToday() {
    const timezone = data?.branches.find((branch) => branch.id === filters.branchId)?.timezone ?? "America/Mexico_City";
    const date = dateInTimeZone(new Date(), timezone);
    setFilters((current) => ({ ...current, from: date, to: date }));
  }
  function openDetail(id: string) { setDetailId(id); }
  function closeDetail() { setDetailId(""); }

  const employeeOptions = data?.employees ?? [];
  const summary = data?.summary;
  const indicators = [
    { label: "Empleados con asistencia", value: summary?.employees },
    { label: "Jornadas en curso", value: summary?.open },
    { label: "Jornadas terminadas", value: summary?.closed },
    { label: "Con incidencias", value: summary?.incidents },
  ];
  const hasNarrowingFilters = Boolean(applied.branchId || applied.employeeId || applied.status !== "all");

  return <section className="space-y-6">
    <header><p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Control de jornada</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Asistencias</h1><p className="mt-1 text-sm text-slate-500">Consulta entradas, salidas y tiempo trabajado del equipo.</p></header>

    <section aria-label="Resumen de asistencias" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {indicators.map((item) => <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{item.label}</p><p className="mt-2 text-xl font-bold text-slate-950">{loading ? <span className="inline-block h-6 w-10 animate-pulse rounded bg-slate-100" /> : error ? "—" : item.value ?? 0}</p><p className="mt-1 text-[10px] text-slate-400">{applied.from} – {applied.to}</p></article>)}
    </section>

    <form onSubmit={applyFilters} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-bold text-slate-900">Filtrar registros</h2><button type="button" onClick={setToday} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100"><CalendarDays size={15} />Hoy</button></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <label className="text-xs font-semibold text-slate-600">Desde<input type="date" aria-label="Fecha desde" value={filters.from} max={filters.to} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className={`${inputClass} mt-1 block`} /></label>
        <label className="text-xs font-semibold text-slate-600">Hasta<input type="date" aria-label="Fecha hasta" value={filters.to} min={filters.from} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className={`${inputClass} mt-1 block`} /></label>
        <label className="text-xs font-semibold text-slate-600">Sucursal<select aria-label="Filtrar por sucursal" value={filters.branchId} onChange={(event) => setFilters({ ...filters, branchId: event.target.value, employeeId: "" })} className={`${inputClass} mt-1 block`}><option value="">Todas</option>{(data?.branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Empleado<select aria-label="Filtrar por empleado" value={filters.employeeId} onChange={(event) => setFilters({ ...filters, employeeId: event.target.value })} className={`${inputClass} mt-1 block`}><option value="">Todos</option>{employeeOptions.filter((item) => !filters.branchId || item.branchId === filters.branchId).map((item) => <option key={item.id} value={item.id}>{item.employeeNumber} · {item.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Estado<select aria-label="Filtrar por estado" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className={`${inputClass} mt-1 block`}><option value="all">Todos</option><option value="open">En curso</option><option value="closed">Terminadas</option><option value="incomplete">Descanso incompleto</option><option value="unscheduled">Sin horario programado</option><option value="incidents">Con incidencias</option></select></label>
        <div className="flex items-end gap-2"><button className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#14264a] px-3 text-xs font-semibold text-white hover:bg-blue-900"><Search size={14} />Consultar</button><button type="button" onClick={clearFilters} className="h-11 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">Limpiar</button></div>
      </div>
    </form>

    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{error}</span><button type="button" onClick={() => { setRequest({ key: requestUrl, status: "loading" }); setRetry((value) => value + 1); }} className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold"><RefreshCw size={14} />Reintentar</button></div> : null}
    {data?.truncated ? <p role="status" className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle size={15} />Se muestran hasta 500 jornadas. Reduce el rango para consultar más resultados.</p> : null}

    {detailId ? <AttendanceDetail detail={detail} loading={detailLoading} error={detailError} onClose={closeDetail} onRetry={() => { setDetailRequest({ key: detailKey, status: "loading" }); setDetailRetry((value) => value + 1); }} /> : <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4 sm:p-5"><div><h2 className="text-sm font-bold text-slate-900">Registros</h2><p className="mt-1 text-xs text-slate-500">Periodo: {applied.from} – {applied.to}{applied.branchId ? ` · ${data?.branches.find((branch) => branch.id === applied.branchId)?.name ?? "Sucursal"}` : " · Todas las sucursales"}</p></div><span className="inline-flex items-center gap-2 text-xs text-slate-500">{loading ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={14} />}{loading ? "Cargando registros…" : `${data?.items.length ?? 0} jornadas`}</span></div>
      {error ? <div className="p-5 text-sm text-slate-500">No se muestran registros hasta recuperar la conexión.</div> : loading ? <div className="grid min-h-48 place-items-center text-sm text-slate-500"><span className="inline-flex items-center gap-2"><LoaderCircle size={17} className="animate-spin" />Consultando el periodo seleccionado…</span></div> : !data?.items.length ? <div className="px-6 py-14 text-center"><CalendarDays className="mx-auto text-slate-300" size={26} /><h3 className="mt-3 text-sm font-semibold text-slate-800">{hasNarrowingFilters ? "No hay resultados con estos filtros" : "No hay jornadas registradas en este periodo"}</h3><p className="mt-1 text-xs text-slate-500">Prueba otras fechas o limpia los filtros para ampliar la consulta.</p></div> : <>
        <div className="space-y-3 p-3 lg:hidden">{data.items.map((item) => <article key={item.session_id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-900">{item.employee.name}</h3><p className="mt-1 text-xs text-slate-500">{item.employee.employeeNumber} · {item.local_work_date}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusStyle[item.classification]}`}>{classify(item)}</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><p className="text-slate-500">Entrada <strong className="ml-1 text-slate-800">{item.startedAt ? formatInTimeZone(item.startedAt, item.branchTimezone) : "—"}</strong></p><p className="text-slate-500">Salida <strong className="ml-1 text-slate-800">{item.endedAt ? formatInTimeZone(item.endedAt, item.branchTimezone) : "En curso"}</strong></p><p className="text-slate-500">Trabajado <strong className="ml-1 text-slate-800">{duration(item.effective_work_minutes)}</strong></p><p className="text-slate-500">Sucursal <strong className="ml-1 text-slate-800">{item.branchName}</strong></p></div><button type="button" onClick={() => openDetail(item.session_id)} className="mt-3 min-h-10 w-full rounded-lg border border-slate-200 text-xs font-semibold text-blue-800 hover:bg-slate-50">Ver detalle</button></article>)}</div>
        <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[760px] text-left"><thead><tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500"><th className="px-4 py-3">Empleado</th><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Entrada</th><th className="px-4 py-3">Salida</th><th className="px-4 py-3">Tiempo trabajado</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3"><span className="sr-only">Detalle</span></th></tr></thead><tbody className="divide-y divide-slate-100">{data.items.map((item) => <tr key={item.session_id} className="text-xs hover:bg-slate-50/70"><td className="px-4 py-3"><p className="font-semibold text-slate-800">{item.employee.name}</p><p className="mt-1 text-[10px] text-slate-400">{item.employee.employeeNumber} · {item.branchName}</p></td><td className="px-4 py-3 text-slate-600">{item.local_work_date}</td><td className="px-4 py-3 text-slate-700">{item.startedAt ? formatInTimeZone(item.startedAt, item.branchTimezone) : "—"}</td><td className="px-4 py-3 text-slate-700">{item.endedAt ? formatInTimeZone(item.endedAt, item.branchTimezone) : "En curso"}</td><td className="px-4 py-3 font-semibold text-slate-800">{duration(item.effective_work_minutes)}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusStyle[item.classification]}`}>{classify(item)}</span></td><td className="px-4 py-3"><button type="button" onClick={() => openDetail(item.session_id)} className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-semibold text-blue-800 hover:bg-slate-50">Ver detalle</button></td></tr>)}</tbody></table></div>
      </>}
      <p className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500"><Clock3 size={14} />El excedente detectado no equivale a horas extra autorizadas.</p>
    </section>}
  </section>;
}

function AttendanceDetail({ detail, loading, error, onClose, onRetry }: { detail: Detail | null; loading: boolean; error: string; onClose: () => void; onRetry: () => void }) {
  const movements = useMemo(() => (detail?.events ?? []).map((event) => ({ id: event.id, title: eventText[event.event_type] ?? "Movimiento", at: event.occurred_at })), [detail?.events]);
  return <section aria-labelledby="attendance-detail-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Detalle de jornada</p><h2 id="attendance-detail-title" className="mt-1 text-lg font-bold text-slate-950">{detail?.employee.name ?? "Registro de asistencia"}</h2>{detail ? <p className="mt-1 text-xs text-slate-500">{detail.session.local_work_date} · {detail.branch.name} · {detail.session.status === "open" ? "En curso" : "Terminada"}</p> : null}</div><button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Volver a registros</button></div>
    {loading ? <div className="grid min-h-48 place-items-center text-sm text-slate-500"><span className="inline-flex items-center gap-2"><LoaderCircle size={17} className="animate-spin" />Cargando detalle…</span></div> : error ? <div role="alert" className="m-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{error}</span><button type="button" onClick={onRetry} className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold"><RefreshCw size={14} />Reintentar</button></div> : detail ? <div className="grid gap-5 p-5 lg:grid-cols-2"><section className="rounded-xl bg-slate-50 p-4"><h3 className="text-xs font-bold text-slate-800">Movimientos registrados</h3>{movements.length ? <ol className="mt-3 space-y-3">{movements.map((movement) => <li key={movement.id} className="flex items-center justify-between gap-3 border-b border-slate-200 pb-2 text-xs"><span className="font-medium text-slate-700">{movement.title}</span><time className="text-slate-600">{formatInTimeZone(movement.at, detail.session.timezone)}</time></li>)}</ol> : <p className="mt-3 text-xs text-slate-500">No hay movimientos disponibles.</p>}<h3 className="mt-5 text-xs font-bold text-slate-800">Descansos</h3>{detail.breaks.length ? <ul className="mt-3 space-y-2">{detail.breaks.map((item) => <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs"><p className="font-semibold text-slate-700">{item.rule?.name ?? "Descanso"}{item.is_incomplete ? " · Incompleto" : ""}</p><p className="mt-1 text-slate-500">{item.started_at ? formatInTimeZone(item.started_at, detail.session.timezone) : "Sin inicio"} – {item.ended_at ? formatInTimeZone(item.ended_at, detail.session.timezone) : "Sin fin"} · {item.counts_as_work ? "Computable" : "No computable"}</p></li>)}</ul> : <p className="mt-3 text-xs text-slate-500">No se registraron descansos.</p>}</section><section><h3 className="text-xs font-bold text-slate-800">Resumen</h3><div className="mt-3 grid grid-cols-2 gap-3">{[{ label: "Entrada", value: detail.session.started_at ? formatInTimeZone(detail.session.started_at, detail.session.timezone) : "—" }, { label: "Salida", value: detail.session.ended_at ? formatInTimeZone(detail.session.ended_at, detail.session.timezone) : "Jornada en curso" }, { label: "Permanencia", value: duration(detail.totals.presence_minutes) }, { label: "Tiempo trabajado", value: duration(detail.totals.effective_work_minutes) }, { label: "Descansos", value: duration(detail.totals.all_break_minutes) }, { label: "Horario programado", value: detail.totals.scheduled_minutes === null ? "Sin horario programado" : `${detail.session.scheduled_start_at ? formatInTimeZone(detail.session.scheduled_start_at, detail.session.timezone) : "—"} – ${detail.session.scheduled_end_at ? formatInTimeZone(detail.session.scheduled_end_at, detail.session.timezone) : "—"}` }].map((item) => <article key={item.label} className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] text-slate-500">{item.label}</p><p className="mt-1 text-xs font-semibold text-slate-800">{item.value}</p></article>)}</div><div className="mt-4 rounded-xl border border-slate-200 p-4"><h4 className="text-xs font-bold text-slate-800">Incidencias</h4><div className="mt-2 flex flex-wrap gap-2">{detail.session.status === "open" ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700">Jornada en curso</span> : null}{detail.totals.has_incomplete_breaks ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">Descanso incompleto</span> : null}{detail.totals.scheduled_minutes === null ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">Sin horario programado</span> : null}{Number(detail.totals.lateness_minutes ?? 0) > 0 ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">Retardo: {duration(detail.totals.lateness_minutes)}</span> : null}{Number(detail.totals.early_departure_minutes ?? 0) > 0 ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">Salida anticipada: {duration(detail.totals.early_departure_minutes)}</span> : null}{detail.session.status === "closed" && Number(detail.totals.detected_overtime_minutes ?? 0) > 0 ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700">Excedente detectado (no autorizado): {duration(detail.totals.detected_overtime_minutes)}</span> : null}{detail.session.status === "closed" && !detail.totals.has_incomplete_breaks && detail.totals.scheduled_minutes !== null && !Number(detail.totals.lateness_minutes ?? 0) && !Number(detail.totals.early_departure_minutes ?? 0) ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700"><Check size={12} />Sin incidencias detectadas</span> : null}</div></div></section></div> : null}
  </section>;
}
