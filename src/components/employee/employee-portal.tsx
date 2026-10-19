"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, LogOut, RefreshCw, ShieldCheck, UserRound, WalletCards } from "lucide-react";

import { signOutEmployee } from "@/app/(employee)/mi-qr/actions";
import Link from "next/link";

type PortalPayload = {
  linked: boolean;
  reason?: string;
  items: Array<{
    company: { id: string; name: string };
    employee: { id: string; number: string; firstName: string; lastName: string; active: boolean };
    branch: { id: string; name: string; timezone: string; active: boolean } | null;
    schedule: null | { assignment: { starts_on: string; ends_on: string | null; planned_start_local: string | null; planned_end_local: string | null; planned_minutes: number; timezone: string }; template: null | { name: string; kind: string; workday_type: string; entry_tolerance_minutes: number; days: Array<{ iso_weekday: number; start_local: string | null; end_local: string | null; scheduled_minutes: number; breaks: Array<{ start: string; end: string; minutes: number; ruleName: string; countsAsWork: boolean; required: boolean }> }> } };
    attendance: Array<{ id: string; local_work_date: string; status: string; started_at: string; ended_at: string | null; latestEvent: { event_type: string; occurred_at: string } | null; totals: null | { presence_minutes: number; all_break_minutes: number; non_work_break_minutes: number; effective_work_minutes: number; scheduled_minutes: number | null; lateness_minutes: number | null; early_departure_minutes: number | null; detected_overtime_minutes: number | null; has_incomplete_breaks: boolean }; breaks: Array<{ id: string; counts_as_work: boolean; started_at: string; ended_at: string | null; is_incomplete: boolean }>; overtime: Array<{ id: string; minutes: number; status: string; reason: string; requested_at: string; decided_at: string | null }> }>;
    credential: { status: "active" | "revoked" | "not_issued"; issuedAt: string | null; revokedAt: string | null };
  }>;
  pagination?: { page: number; pages: number; total: number };
};

type Tab = "resumen" | "horario" | "asistencias" | "horas-extra" | "credencial";
const tabs: Array<{ id: Tab; label: string; mobileLabel: string; icon: typeof UserRound }> = [
  { id: "resumen", label: "Inicio", mobileLabel: "Inicio", icon: UserRound },
  { id: "horario", label: "Mi horario", mobileLabel: "Horario", icon: CalendarDays },
  { id: "asistencias", label: "Asistencias", mobileLabel: "Registros", icon: Clock3 },
  { id: "horas-extra", label: "Horas extra", mobileLabel: "Extra", icon: WalletCards },
  { id: "credencial", label: "Credencial", mobileLabel: "Mi QR", icon: ShieldCheck },
];
const weekdayNames = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const eventNames: Record<string, string> = { clock_in: "Entrada", break_start: "Inicio de descanso", break_end: "Regreso de descanso", clock_out: "Salida" };
const card = "rounded-2xl border border-slate-200 bg-white shadow-[0_4px_20px_rgba(18,38,75,.04)]";

function duration(minutes: number | null | undefined) {
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
function time(value: string | null | undefined) { return value ? value.slice(0, 5) : "Variable"; }
function date(value: string | null | undefined) { return value ? new Date(value).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }
function timestamp(value: string | null | undefined, timezone?: string | null) {
  return value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(value)) : "—";
}

export function EmployeePortal() {
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>("resumen");
  const [employeeId, setEmployeeId] = useState("");
  const load = useCallback(async (nextPage: number, signal?: AbortSignal) => {
    setLoading(true); setError(""); setPayload(null);
    try {
      const response = await fetch(`/api/employee/portal?page=${nextPage}`, { cache: "no-store", signal });
      const body = await response.json() as PortalPayload & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "No fue posible cargar tu portal.");
      setPayload(body);
      if (body.items?.length) setEmployeeId((current) => body.items.some((item) => item.employee.id === current) ? current : body.items[0].employee.id);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "No fue posible cargar tu portal.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(page, controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, page]);

  const item = useMemo(() => payload?.items.find((entry) => entry.employee.id === employeeId) ?? payload?.items[0] ?? null, [payload, employeeId]);
  const currentSession = item?.attendance.find((session) => session.status === "open") ?? item?.attendance[0] ?? null;
  const overtimeSummary = useMemo(() => (item?.attendance ?? []).reduce((summary, session) => {
    summary.detected += session.totals?.detected_overtime_minutes ?? 0;
    for (const authorization of session.overtime) {
      if (authorization.status === "approved") summary.approved += authorization.minutes;
      if (authorization.status === "pending") summary.pending += authorization.minutes;
    }
    return summary;
  }, { detected: 0, approved: 0, pending: 0 }), [item]);

  return <div className="min-h-screen bg-[#f4f7fc] pb-24 text-slate-900 md:pb-8">
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-700 text-white"><Clock3 size={20} /></div><div className="min-w-0"><p className="text-xs font-bold tracking-[.12em] text-slate-900">ASISTENCIA</p><p className="truncate text-[11px] text-slate-500">Portal del empleado{item ? ` · ${item.company.name}` : ""}</p></div></div>
        <div className="flex items-center gap-2"><Link href="/seleccionar-empresa" className="rounded-lg px-2 py-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-50">Cambiar empresa/rol</Link><button type="button" onClick={() => void load(page)} disabled={loading} className="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50" aria-label="Actualizar"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button><form action={signOutEmployee}><button type="submit" className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100"><LogOut size={16} /><span className="hidden sm:inline">Cerrar sesión</span></button></form></div>
      </div>
    </header>
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      {error ? <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}
      {loading && !payload ? <div className="space-y-4" aria-live="polite"><div className="h-36 animate-pulse rounded-2xl bg-white" /><div className="h-72 animate-pulse rounded-2xl bg-white" /></div> : null}
      {payload && !payload.linked ? <section className={`${card} mx-auto max-w-xl p-6 text-center sm:p-10`}><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-700"><UserRound size={25} /></div><h1 className="mt-4 text-xl font-bold">Perfil de empleado no vinculado</h1><p className="mt-2 text-sm leading-6 text-slate-600">Tu cuenta no tiene un perfil de empleado activo asociado. Solicita a la administración que verifique la vinculación de tu cuenta. No se mostraron datos de otras personas.</p></section> : null}
      {item ? <>
        {payload && payload.items.length > 1 ? <label className="mb-4 block text-xs font-semibold text-slate-600">Empresa<select aria-label="Empresa" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm sm:max-w-sm">{payload.items.map((entry) => <option key={entry.employee.id} value={entry.employee.id}>{entry.company.name} · {entry.employee.firstName} {entry.employee.lastName}</option>)}</select></label> : null}
        <section className={`${card} overflow-hidden`}><div className="bg-gradient-to-r from-[#14264a] to-[#1c4489] p-5 text-white sm:p-7"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-blue-200">Mi espacio</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">Hola, {item.employee.firstName}</h1><p className="mt-1 text-sm text-blue-100">{item.company.name} · {item.branch?.name ?? "Sin sucursal asignada"}</p></div><div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3"><p className="text-[11px] uppercase tracking-wide text-blue-100">Identificador</p><p className="mt-1 text-sm font-semibold">{item.employee.number}</p></div></div></div><div className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0"><Summary label="Jornada actual" value={currentSession?.status === "open" ? "En curso" : currentSession ? "Cerrada" : "Sin registros"} detail={currentSession ? `${date(currentSession.local_work_date)} · ${eventNames[currentSession.latestEvent?.event_type ?? ""] ?? "Actividad registrada"}` : "La asistencia se registra mediante supervisión autorizada."} /><Summary label="Horas efectivas recientes" value={duration(currentSession?.totals?.effective_work_minutes)} detail="Cálculo según descansos y horario configurado" /><Summary label="Credencial" value={credentialLabel(item.credential.status)} detail={item.credential.issuedAt ? `Emitida ${date(item.credential.issuedAt)}` : "Consulta la sección Mi credencial"} /></div></section>
        <nav aria-label="Secciones del portal" className="mt-5 hidden gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 md:flex">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold ${tab === id ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}><Icon size={15} />{label}</button>)}</nav>
        <div className="mt-5 space-y-5">
          {tab === "resumen" ? <section className={`${card} p-5 sm:p-6`}><h2 className="text-lg font-bold">Estado de la jornada</h2><p className="mt-1 text-sm text-slate-500">Consulta tu última jornada registrada. Para marcar entrada, comida o salida, sigue el flujo con el supervisor autorizado.</p>{currentSession ? <div className="mt-5 grid gap-3 sm:grid-cols-2"><Info label="Estado" value={currentSession.status === "open" ? "En curso" : "Cerrada"} /><Info label="Último movimiento" value={eventNames[currentSession.latestEvent?.event_type ?? ""] ?? "Sin movimientos"} /><Info label="Entrada" value={timestamp(currentSession.started_at, item.branch?.timezone)} /><Info label="Tiempo efectivo" value={duration(currentSession.totals?.effective_work_minutes)} /></div> : <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Aún no hay jornadas asociadas a tu perfil.</p>}</section> : null}
          {tab === "horario" ? <section className={`${card} overflow-hidden`}><div className="border-b border-slate-100 p-5 sm:p-6"><h2 className="text-lg font-bold">Mi horario</h2><p className="mt-1 text-sm text-slate-500">Asignación vigente para {item.branch?.name ?? "tu sucursal"}.</p></div>{item.schedule ? <><div className="px-5 pt-5 text-sm"><strong>{item.schedule.template?.name ?? "Horario variable"}</strong><span className="ml-2 text-slate-500">Vigente desde {date(item.schedule.assignment.starts_on)}{item.schedule.assignment.ends_on ? ` hasta ${date(item.schedule.assignment.ends_on)}` : ""}</span></div>{item.schedule.template ? <div className="divide-y divide-slate-100 p-5">{[...item.schedule.template.days].sort((a, b) => a.iso_weekday - b.iso_weekday).map((day) => <div key={day.iso_weekday} className="grid gap-2 py-3 sm:grid-cols-[120px_1fr]"><div className="text-sm font-semibold">{weekdayNames[day.iso_weekday]}</div><div className="text-sm text-slate-700">{time(day.start_local)} – {time(day.end_local)} <span className="text-slate-500">· {duration(day.scheduled_minutes)}</span>{day.breaks.length ? <div className="mt-2 flex flex-wrap gap-2">{day.breaks.map((breakItem, index) => <span key={`${day.iso_weekday}-${index}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600">{breakItem.ruleName}: {time(breakItem.start)}–{time(breakItem.end)} · {breakItem.countsAsWork ? "Computa como trabajo" : "No computable"}</span>)}</div> : null}</div></div>)}</div> : <p className="p-5 text-sm text-slate-600">{time(item.schedule.assignment.planned_start_local)} – {time(item.schedule.assignment.planned_end_local)} · {duration(item.schedule.assignment.planned_minutes)}. La asignación no usa una plantilla semanal fija.</p>}</> : <p className="p-5 text-sm text-slate-600">No hay un horario vigente asociado a tu perfil. Consulta a la administración.</p>}</section> : null}
          {tab === "asistencias" ? <section className={`${card} overflow-hidden`}><div className="border-b border-slate-100 p-5"><h2 className="text-lg font-bold">Mis asistencias</h2><p className="mt-1 text-sm text-slate-500">Tus jornadas recientes y sus cálculos.</p></div>{item.attendance.length ? <div className="divide-y divide-slate-100">{item.attendance.map((session) => <article key={session.id} className="p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{date(session.local_work_date)}</h3><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${session.status === "open" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{session.status === "open" ? "En curso" : "Cerrada"}</span></div><p className="mt-2 text-xs text-slate-500">Entrada {timestamp(session.started_at, item.branch?.timezone)} · Salida {timestamp(session.ended_at, item.branch?.timezone)}</p><div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><Info label="Permanencia" value={duration(session.totals?.presence_minutes)} /><Info label="Descansos" value={duration(session.totals?.all_break_minutes)} /><Info label="Tiempo efectivo" value={duration(session.totals?.effective_work_minutes)} /><Info label="Excedente detectado" value={duration(session.totals?.detected_overtime_minutes)} /></div>{session.totals?.has_incomplete_breaks ? <p className="mt-3 text-xs font-medium text-amber-700">Jornada con un descanso incompleto.</p> : null}</article>)}</div> : <p className="p-5 text-sm text-slate-600">No hay asistencias para mostrar.</p>}{(payload?.pagination?.pages ?? 0) > 1 ? <div className="flex items-center justify-between border-t border-slate-100 p-4"><span className="text-xs text-slate-500">Página {page} de {payload?.pagination?.pages}</span><div className="flex gap-2"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading} className="h-9 rounded-lg border border-slate-200 px-3 text-xs disabled:opacity-40">Anterior</button><button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= (payload?.pagination?.pages ?? 1) || loading} className="h-9 rounded-lg border border-slate-200 px-3 text-xs disabled:opacity-40">Siguiente</button></div></div> : null}</section> : null}
          {tab === "horas-extra" ? <section className={`${card} p-5 sm:p-6`}><h2 className="text-lg font-bold">Mis horas extra</h2><p className="mt-1 text-sm text-slate-500">El excedente detectado se muestra separado del tiempo extra autorizado.</p><div className="mt-5 grid gap-3 sm:grid-cols-3"><Metric label="Detectado en jornadas recientes" value={duration(overtimeSummary.detected)} /><Metric label="Autorizado" value={duration(overtimeSummary.approved)} /><Metric label="Solicitud pendiente" value={duration(overtimeSummary.pending)} /></div><div className="mt-5 divide-y divide-slate-100">{item.attendance.flatMap((session) => session.overtime.map((authorization) => <div key={authorization.id} className="py-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{date(session.local_work_date)} · {duration(authorization.minutes)}</span><span className="text-xs capitalize text-slate-500">{authorization.status === "approved" ? "Autorizada" : authorization.status === "pending" ? "Pendiente" : authorization.status === "rejected" ? "Rechazada" : authorization.status}</span></div>{authorization.reason ? <p className="mt-1 text-xs text-slate-500">{authorization.reason}</p> : null}</div>))}</div></section> : null}
          {tab === "credencial" ? <section className={`${card} p-5 sm:p-6`}><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-xl bg-violet-50 text-violet-700"><ShieldCheck size={20} /></div><div><h2 className="text-lg font-bold">Mi credencial</h2><p className="text-sm text-slate-500">Estado actual de la credencial QR personal.</p></div></div><div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="font-semibold">{credentialLabel(item.credential.status)}</p>{item.credential.issuedAt ? <p className="mt-1 text-sm text-slate-600">Emitida el {timestamp(item.credential.issuedAt, item.branch?.timezone)}.</p> : null}{item.credential.revokedAt ? <p className="mt-1 text-sm text-slate-600">Revocada el {timestamp(item.credential.revokedAt, item.branch?.timezone)}.</p> : null}<p className="mt-3 text-sm leading-6 text-slate-600">Por seguridad, esta pantalla no vuelve a mostrar el código QR original. El token se entrega una sola vez al emitir la credencial. Si necesitas una copia o una nueva credencial, solicita apoyo a la administración; una regeneración invalida el código anterior.</p></div></section> : null}
        </div>
      </> : null}
    </div>
    <nav aria-label="Navegación móvil" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">{tabs.map(({ id, label, mobileLabel, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} aria-label={label} title={label} aria-current={tab === id ? "page" : undefined} className={`flex min-w-0 min-h-16 flex-col items-center justify-center gap-1 whitespace-nowrap text-[9px] font-semibold leading-none ${tab === id ? "text-blue-700" : "text-slate-500"}`}><Icon size={18} /><span>{mobileLabel}</span></button>)}</nav>
  </div>;
}

function credentialLabel(status: string) { return status === "active" ? "Activa" : status === "revoked" ? "Revocada" : "Aún no emitida"; }
function Summary({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="p-5"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-100 bg-slate-50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-lg font-bold">{value}</p></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value}</p></div>; }
