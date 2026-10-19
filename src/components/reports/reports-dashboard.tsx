"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BarChart3, CalendarDays, FileSpreadsheet, FileText, LoaderCircle, Search, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useAdminContext } from "@/components/admin/admin-context";
import type { ReportAnalytics, ReportRow, ReportSummary } from "@/lib/reports/data";
import { dateInTimeZone } from "@/lib/datetime";
import { canExportReport, getExportFailureMessage, getReportView, reportFiltersMatch, type ReportRequestState } from "@/lib/reports/request-state";

type Payload = {
  company: { id: string; name: string };
  rows: ReportRow[]; totalRows: number; truncated: boolean;
  branches: { id: string; name: string }[];
  employees: { id: string; employeeNumber: string; name: string; branchId: string | null }[];
  summary: ReportSummary; analytics: ReportAnalytics;
  payPeriodRule: { mode: "calendar_half_month" | "fixed_days"; anchorDate: string; intervalDays: number } | null;
  error?: { message?: string };
};
type Period = "custom" | "daily" | "weekly" | "biweekly" | "monthly";
type Filters = { from: string; to: string; branchId: string; employeeId: string; status: "all" | "open" | "closed" | "incomplete"; period: Period };

const today = () => dateInTimeZone(new Date(), "America/Mexico_City");
const shiftDate = (date: string, amount: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); };
const hhmm = (value: string | null, timezone: string) => value ? new Intl.DateTimeFormat("es-MX", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const duration = (value: number | null) => value === null ? "—" : `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, "0")} min`;
const baseInput = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100";

function defaults(employeeId = "", params?: URLSearchParams): Filters {
  const date = today();
  const status = params?.get("status") ?? "all";
  return { from: params?.get("from") ?? shiftDate(date, -29), to: params?.get("to") ?? date, branchId: params?.get("branchId") ?? "", employeeId: params?.get("employeeId") ?? employeeId, status: ["all", "open", "closed", "incomplete"].includes(status) ? status as Filters["status"] : "all", period: "custom" };
}

function startOfWeek(value: string) {
  const d = new Date(`${value}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  return shiftDate(value, -day);
}

export function ReportsDashboard() {
  const { company } = useAdminContext();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const presetEmployee = searchParams.get("employeeId") ?? "";
  const [filters, setFilters] = useState<Filters>(() => defaults(presetEmployee, new URLSearchParams(searchParams.toString())));
  const [applied, setApplied] = useState<Filters>(() => defaults(presetEmployee, new URLSearchParams(searchParams.toString())));
  const [page, setPage] = useState(() => Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1));
  const [sort, setSort] = useState<"date" | "effective" | "employee">("date");
  const [ascending, setAscending] = useState(false);
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const [requestState, setRequestState] = useState<ReportRequestState<Payload> | null>(null);
  const [exportError, setExportError] = useState<{ key: string; message: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [retry, setRetry] = useState(0);

  const params = new URLSearchParams({ companyId: company.companyId, from: applied.from, to: applied.to, status: applied.status, page: String(page), pageSize: "50" });
  if (applied.branchId) params.set("branchId", applied.branchId);
  if (applied.employeeId) params.set("employeeId", applied.employeeId);
  const requestKey = `/api/reports?${params}`;
  const reportView = getReportView(requestState, requestKey);
  const { data, loading } = reportView;
  const reportLoadError = reportView.error;
  const error = reportLoadError || (exportError?.key === requestKey ? exportError.message : "");
  const filtersMatch = reportFiltersMatch(filters, applied);
  const exportEnabled = canExportReport(requestState, requestKey, filtersMatch);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(requestKey, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json() as Payload;
      if (!response.ok) throw new Error(body.error?.message ?? "No fue posible cargar el reporte.");
      if (!controller.signal.aborted) setRequestState({ key: requestKey, status: "success", data: body });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setRequestState({ key: requestKey, status: "error", message: reason instanceof Error ? reason.message : "No fue posible cargar el reporte." });
    });
    return () => controller.abort();
  }, [requestKey, retry]);

  const sortedRows = useMemo(() => {
    const rows = [...(data?.rows ?? [])];
    rows.sort((a, b) => {
      const value = sort === "date" ? a.workDate.localeCompare(b.workDate) : sort === "effective" ? a.effectiveMinutes - b.effectiveMinutes : a.employeeName.localeCompare(b.employeeName, "es");
      return ascending ? value : -value;
    });
    return rows;
  }, [data?.rows, sort, ascending]);
  const pageCount = Math.max(1, Math.ceil((data?.totalRows ?? 0) / 50));

  function setPeriod(period: Period) {
    const currentTo = filters.to || today();
    let to = currentTo;
    let from = filters.from;
    if (period === "daily") from = to;
    else if (period === "weekly") { from = startOfWeek(to); to = shiftDate(from, 6); }
    else if (period === "monthly") { from = `${to.slice(0, 7)}-01`; const date = new Date(`${from}T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1, 0); to = date.toISOString().slice(0, 10); }
    else if (period === "biweekly") {
      const rule = data?.payPeriodRule;
      if (rule?.mode === "fixed_days") {
        const daysFromAnchor = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${rule.anchorDate}T00:00:00Z`)) / 86_400_000);
        from = shiftDate(rule.anchorDate, Math.floor(daysFromAnchor / rule.intervalDays) * rule.intervalDays);
        to = shiftDate(from, rule.intervalDays - 1);
      } else {
        const day = Number(to.slice(8));
        from = shiftDate(to, day <= 15 ? 1 - day : 16 - day);
        to = day <= 15 ? `${to.slice(0, 7)}-15` : (() => { const date = new Date(`${to.slice(0, 7)}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1, 0); return date.toISOString().slice(0, 10); })();
      }
    }
    setFilters((current) => ({ ...current, period, from, to }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1); setApplied({ ...filters }); setSelected(null); syncFiltersToUrl(filters, 1);
  }

  function clearFilters() {
    const fresh = defaults(); setFilters(fresh); setApplied(fresh); setPage(1); setSelected(null);
    const query = new URLSearchParams(searchParams.toString());
    for (const key of ["from", "to", "branchId", "employeeId", "status", "page"]) query.delete(key);
    router.replace(`${pathname}${query.size ? `?${query.toString()}` : ""}`, { scroll: false });
  }

  function syncFiltersToUrl(value: Filters, nextPage: number) {
    const query = new URLSearchParams(searchParams.toString());
    for (const key of ["from", "to", "branchId", "employeeId", "status", "page"]) query.delete(key);
    for (const key of ["from", "to", "branchId", "employeeId", "status"] as const) if (value[key]) query.set(key, value[key]);
    if (nextPage > 1) query.set("page", String(nextPage));
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }

  async function download(format: "xlsx" | "pdf") {
    if (!canExportReport(requestState, requestKey, reportFiltersMatch(filters, applied))) return;
    setExporting(true); setExportError(null);
    try {
      const exportParams = new URLSearchParams({ ...Object.fromEntries(params.entries()), all: "true", format });
      exportParams.delete("page"); exportParams.delete("pageSize");
      const response = await fetch(`/api/reports/export?${exportParams}`, { cache: "no-store" });
      if (!response.ok) throw new Error(getExportFailureMessage(await response.text(), response.status));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `reporte.${format}`;
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
    } catch (reason) { setExportError({ key: requestKey, message: reason instanceof Error ? reason.message : "No fue posible generar el archivo." }); }
    finally { setExporting(false); }
  }

  const summary = data?.summary;
  const keyMetrics = [
    { label: "Empleados con asistencia", value: summary?.employees, hint: "En el periodo seleccionado" },
    { label: "Jornadas registradas", value: summary?.sessions, hint: `${summary?.open ?? 0} en curso` },
    { label: "Horas efectivas", value: summary ? duration(summary.effectiveMinutes) : undefined, hint: "Tiempo laborado calculado" },
    { label: "Jornadas con incidencias", value: summary?.incidents, hint: "En curso, sin horario o con variaciones" },
  ];

  return <section className="space-y-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Asistencias</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Reportes</h1><p className="mt-1 text-sm text-slate-500">Consulta un periodo y descarga el resultado con los filtros aplicados.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={exporting || !exportEnabled} onClick={() => void download("xlsx")} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-blue-200 disabled:opacity-50"><FileSpreadsheet size={15} />{exporting ? "Generando…" : "Descargar Excel"}</button><button type="button" disabled={exporting || !exportEnabled} onClick={() => void download("pdf")} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#14264a] px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-900 disabled:opacity-50"><FileText size={15} />PDF</button></div></header>

    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className="text-xs font-semibold text-slate-600">Periodo<select value={filters.period} onChange={(e) => setPeriod(e.target.value as Period)} className={`${baseInput} mt-1 block w-full`}><option value="custom">Personalizado</option><option value="daily">Diario</option><option value="weekly">Semanal</option><option value="biweekly">Quincenal</option><option value="monthly">Mensual</option></select></label>
        <label className="text-xs font-semibold text-slate-600">Desde<input aria-label="Fecha desde" type="date" value={filters.from} max={filters.to} onChange={(e) => setFilters({ ...filters, from: e.target.value, period: "custom" })} className={`${baseInput} mt-1 block w-full`} /></label>
        <label className="text-xs font-semibold text-slate-600">Hasta<input aria-label="Fecha hasta" type="date" value={filters.to} min={filters.from} onChange={(e) => setFilters({ ...filters, to: e.target.value, period: "custom" })} className={`${baseInput} mt-1 block w-full`} /></label>
        <label className="text-xs font-semibold text-slate-600">Sucursal<select value={filters.branchId} onChange={(e) => setFilters({ ...filters, branchId: e.target.value, employeeId: "" })} className={`${baseInput} mt-1 block w-full`}><option value="">Todas</option>{(data?.branches ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Empleado<select value={filters.employeeId} onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })} className={`${baseInput} mt-1 block w-full`}><option value="">Todos</option>{(data?.employees ?? []).filter((item) => !filters.branchId || item.branchId === filters.branchId).map((item) => <option key={item.id} value={item.id}>{item.employeeNumber} · {item.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Estado<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters["status"] })} className={`${baseInput} mt-1 block w-full`}><option value="all">Todos</option><option value="open">En curso</option><option value="closed">Terminadas</option><option value="incomplete">Incompletas</option></select></label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-6"><button className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white hover:bg-blue-900"><Search size={14} />Consultar</button><button type="button" onClick={clearFilters} className="h-11 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">Limpiar filtros</button></div>
      </div>
    </form>
    {!filtersMatch ? <p role="status" className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">Cambiaste los filtros. Pulsa «Consultar» para actualizar el reporte y habilitar la descarga con estos valores.</p> : null}

    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{error}</span>{reportView.error ? <button type="button" onClick={() => { setRequestState({ key: requestKey, status: "loading" }); setRetry((value) => value + 1); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold"><LoaderCircle size={14} />Reintentar consulta</button> : null}</div> : null}
    {data?.truncated ? <p role="status" className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle size={15} />El informe supera 5,000 jornadas. Reduce el rango para obtener totales completos y exportar.</p> : null}

    <section aria-label="Resumen del reporte" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{keyMetrics.map((item) => <article key={item.label} className="min-h-[104px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{item.label}</p><p className="mt-2 text-xl font-bold tracking-tight text-slate-950">{loading ? <span className="inline-block h-6 w-12 animate-pulse rounded bg-slate-100" /> : reportLoadError ? "—" : item.value ?? 0}</p><p className="mt-1 text-[11px] text-slate-400">{item.hint} · {applied.from} – {applied.to}</p></article>)}</section>

    {data ? <details className="rounded-2xl border border-slate-200 bg-white shadow-sm"><summary className="cursor-pointer list-none px-5 py-4 text-sm font-bold text-slate-800"><span className="inline-flex items-center gap-2"><BarChart3 size={16} className="text-blue-700" />Análisis y métricas avanzadas</span><span className="mt-1 block text-xs font-normal text-slate-500">Descansos, retardos, salidas anticipadas y horas extra autorizadas.</span></summary><div className="space-y-4 border-t border-slate-100 p-4 sm:p-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[
      { label: "Presencia", value: duration(summary?.presenceMinutes ?? 0), detail: "Tiempo entre entrada y salida" },
      { label: "Descansos", value: duration((summary?.paidBreakMinutes ?? 0) + (summary?.unpaidBreakMinutes ?? 0)), detail: `${duration(summary?.paidBreakMinutes ?? 0)} computables · ${duration(summary?.unpaidBreakMinutes ?? 0)} no computables` },
      { label: "Retardos", value: duration(summary?.latenessMinutes ?? 0), detail: "Minutos acumulados" },
      { label: "Salidas anticipadas", value: duration(summary?.earlyDepartureMinutes ?? 0), detail: "Minutos acumulados" },
      { label: "Excedente detectado", value: duration(summary?.detectedOvertimeMinutes ?? 0), detail: "Informativo; no es autorización" },
      { label: "Horas extra autorizadas", value: duration(summary?.approvedOvertimeMinutes ?? 0), detail: "Aprobaciones registradas" },
    ].map((item) => <article key={item.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4"><p className="text-xs text-slate-500">{item.label}</p><p className="mt-2 text-base font-bold text-slate-900">{item.value}</p><p className="mt-1 text-[10px] text-slate-400">{item.detail}</p></article>)}</div><div className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="Horas efectivas por día" subtitle="Comparación con minutos programados" icon={<BarChart3 size={16} />}><ResponsiveContainer width="100%" height="100%"><BarChart data={data.analytics.byDay}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} fontSize={10} /><YAxis tickFormatter={(value) => `${Math.round(value / 60)}h`} fontSize={10} /><Tooltip formatter={(value) => duration(Number(value))} /><Legend /><Bar dataKey="scheduledMinutes" name="Programadas" fill="#cbd5e1" radius={[3, 3, 0, 0]} /><Bar dataKey="effectiveMinutes" name="Efectivas" fill="#2563eb" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Retardos por empleado" subtitle="Minutos acumulados en el periodo" icon={<BarChart3 size={16} />}><ResponsiveContainer width="100%" height="100%"><BarChart data={data.analytics.byEmployee} layout="vertical" margin={{ left: 8, right: 18 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" fontSize={10} /><YAxis type="category" dataKey="name" width={105} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => duration(Number(value))} /><Bar dataKey="latenessMinutes" name="Retardo" fill="#f59e0b" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Excedente y horas autorizadas" subtitle="Detección y autorización separadas" icon={<BarChart3 size={16} />}><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: "Horas", detected: summary?.detectedOvertimeMinutes ?? 0, approved: summary?.approvedOvertimeMinutes ?? 0 }]}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={10} /><YAxis tickFormatter={(value) => `${Math.round(value / 60)}h`} fontSize={10} /><Tooltip formatter={(value) => duration(Number(value))} /><Legend /><Bar dataKey="detected" name="Excedente detectado" fill="#f59e0b" radius={[4, 4, 0, 0]} /><Bar dataKey="approved" name="Extra autorizada" fill="#10b981" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Comparación de sucursales" subtitle={`${summary?.incomplete ?? 0} jornadas incompletas en el periodo`} icon={<BarChart3 size={16} />}><ResponsiveContainer width="100%" height="100%"><BarChart data={data.analytics.byBranch}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={10} /><YAxis tickFormatter={(value) => `${Math.round(value / 60)}h`} fontSize={10} /><Tooltip formatter={(value) => duration(Number(value))} /><Legend /><Bar dataKey="scheduledMinutes" name="Programadas" fill="#cbd5e1" radius={[3, 3, 0, 0]} /><Bar dataKey="effectiveMinutes" name="Efectivas" fill="#0f766e" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Jornadas incompletas" subtitle="Abiertas y con descansos sin cerrar" icon={<BarChart3 size={16} />}><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: "Jornadas", incomplete: summary?.incomplete ?? 0, closed: Math.max(0, (summary?.sessions ?? 0) - (summary?.incomplete ?? 0)) }]}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={10} /><YAxis allowDecimals={false} fontSize={10} /><Tooltip /><Legend /><Bar dataKey="incomplete" name="Incompletas" fill="#f59e0b" radius={[4, 4, 0, 0]} /><Bar dataKey="closed" name="Completas" fill="#10b981" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
    </div></div></details> : loading ? <div className="grid h-40 place-items-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500"><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={17} />Calculando el reporte…</span></div> : null}

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-bold text-slate-900">Jornadas del reporte</h2><p className="mt-1 text-xs text-slate-500">{data ? `${data.totalRows} jornadas · página ${page} de ${pageCount} · ${applied.from} – ${applied.to}` : "Las jornadas aparecerán después de consultar el periodo."}</p></div><span className="inline-flex items-center gap-2 text-xs text-slate-500">{loading ? <LoaderCircle size={14} className="animate-spin" /> : <CalendarDays size={14} />}{loading ? "Actualizando" : `${data?.totalRows ?? 0} registros`}</span></div>
      {!data && loading ? <div className="grid min-h-40 place-items-center text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} /></div> : null}
      {!data && !loading && !error ? <div className="p-10 text-center text-sm text-slate-500">No hay información disponible para este reporte.</div> : null}
      {data && !sortedRows.length ? <div className="px-5 py-14 text-center"><CalendarDays className="mx-auto text-slate-300" size={24} /><p className="mt-3 text-sm font-semibold text-slate-700">No hay jornadas en este periodo</p><p className="mt-1 text-xs text-slate-500">Cambia el rango o limpia los filtros.</p></div> : null}
      {data && sortedRows.length ? <>
        <div className="space-y-3 p-3 lg:hidden">{sortedRows.map((row) => <article key={row.sessionId} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">{row.employeeName}</h3><p className="mt-1 text-xs text-slate-500">{row.employeeNumber} · {row.workDate}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${row.incomplete ? "bg-amber-50 text-amber-800" : row.unscheduled ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"}`}>{row.status === "open" ? "En curso" : row.incomplete ? "Incompleta" : row.unscheduled ? "Sin horario" : "Terminada"}</span></div><p className="mt-2 text-xs text-slate-500">{row.branchName} · {hhmm(row.clockIn, row.timezone)}–{hhmm(row.clockOut, row.timezone)} · <strong className="text-slate-800">{duration(row.effectiveMinutes)}</strong></p><button type="button" onClick={() => setSelected(selected?.sessionId === row.sessionId ? null : row)} className="mt-3 min-h-10 w-full rounded-lg border border-slate-200 text-xs font-semibold text-blue-800">{selected?.sessionId === row.sessionId ? "Cerrar detalle" : "Ver detalle"}</button></article>)}</div>
        <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[850px] text-left"><thead><tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500"><th className="px-4 py-3"><button type="button" onClick={() => toggleSort("employee")} className="text-left">Empleado · fecha ↕</button></th><th className="px-4 py-3">Sucursal · estado</th><th className="px-4 py-3">Entrada · salida</th><th className="px-4 py-3"><button type="button" onClick={() => toggleSort("effective")} className="text-left">Horas efectivas ↕</button></th><th className="px-4 py-3">Incidencias</th><th className="px-4 py-3"><span className="sr-only">Detalle</span></th></tr></thead><tbody className="divide-y divide-slate-100">{sortedRows.map((row) => <tr key={row.sessionId} className="text-xs hover:bg-slate-50/70"><td className="px-4 py-3"><p className="font-semibold text-slate-800">{row.employeeName}</p><p className="mt-1 text-[10px] text-slate-400">{row.employeeNumber} · {row.workDate}</p></td><td className="px-4 py-3"><p>{row.branchName}</p><span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${row.incomplete ? "bg-amber-50 text-amber-800" : row.unscheduled ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"}`}>{row.status === "open" ? "En curso" : row.incomplete ? "Incompleta" : row.unscheduled ? "Sin horario" : "Terminada"}</span></td><td className="px-4 py-3">{hhmm(row.clockIn, row.timezone)} – {hhmm(row.clockOut, row.timezone)}</td><td className="px-4 py-3 font-semibold">{duration(row.effectiveMinutes)}</td><td className="px-4 py-3">{row.incidents.length ? row.incidents.join(", ") : "Sin incidencias"}</td><td className="px-4 py-3"><button type="button" onClick={() => setSelected(selected?.sessionId === row.sessionId ? null : row)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-blue-800">{selected?.sessionId === row.sessionId ? "Cerrar" : "Ver detalle"}</button></td></tr>)}</tbody></table></div>
      </> : null}
      {selected ? <div className="border-t border-slate-100 bg-blue-50/50 p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-900">Detalle · {selected.employeeName}</h3><p className="mt-1 text-xs text-slate-600">{selected.workDate} · {selected.branchName}</p></div><button type="button" onClick={() => setSelected(null)} className="grid size-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white" aria-label="Cerrar detalle"><X size={15} /></button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[{ label: "Horario programado", value: selected.scheduledMinutes === null ? "Sin horario programado" : `${hhmm(selected.scheduledStartAt, selected.timezone)} – ${hhmm(selected.scheduledEndAt, selected.timezone)} · ${duration(selected.scheduledMinutes)}` }, { label: "Presencia", value: duration(selected.presenceMinutes) }, { label: "Descansos", value: `${duration(selected.allBreakMinutes)} total · ${duration(selected.unpaidBreakMinutes)} no computables` }, { label: "Tiempo efectivo", value: duration(selected.effectiveMinutes) }, { label: "Retardo", value: duration(selected.latenessMinutes) }, { label: "Salida anticipada", value: duration(selected.earlyDepartureMinutes) }, { label: "Excedente detectado", value: duration(selected.detectedOvertimeMinutes) }, { label: "Horas extra autorizadas", value: duration(selected.approvedOvertimeMinutes) }].map((item) => <article key={item.label} className="rounded-lg border border-blue-100 bg-white p-3"><p className="text-[10px] text-slate-500">{item.label}</p><p className="mt-1 text-xs font-semibold text-slate-800">{item.value}</p></article>)}</div><p className="mt-3 text-[11px] text-slate-600">{selected.incidents.length ? selected.incidents.join(" · ") : "Sin incidencias registradas"}. Una jornada abierta no se presenta como jornada terminada.</p></div> : null}
      {data && pageCount > 1 ? <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><button type="button" disabled={page <= 1} onClick={() => { const value = page - 1; setPage(value); syncFiltersToUrl(applied, value); }} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-40">Anterior</button><span className="text-xs text-slate-500">Página {page} de {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => { const value = page + 1; setPage(value); syncFiltersToUrl(applied, value); }} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-40">Siguiente</button></div> : null}
      <p className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500"><AlertTriangle size={14} />El ordenamiento se aplica únicamente a la página actual. El excedente detectado es informativo; las horas extra autorizadas se muestran aparte.</p>
    </section>
  </section>;

  function toggleSort(value: typeof sort) { if (sort === value) setAscending((current) => !current); else { setSort(value); setAscending(false); } }

}

function ChartCard({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><span className="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-700">{icon}</span><div><h3 className="text-xs font-bold text-slate-800">{title}</h3><p className="mt-1 text-[10px] text-slate-400">{subtitle}</p></div></div><div className="mt-4 h-[235px]">{children}</div></article>;
}
