"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle, ArrowLeft, ArrowRight, CalendarClock, CalendarDays, Check, ChevronDown,
  Coffee, LoaderCircle, MapPin, Pencil, Plus, RefreshCw, Save,
  Search, ShieldCheck, Trash2, Users, X,
} from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";
import { TimePicker } from "@/components/schedules/time-picker";
import { createWeekDraft, getEnabledWeekdays, ISO_WEEKDAYS, patchWeekday, toggleWeekday, type WeekDraft, type WeekdayNumber } from "@/lib/schedules/week-draft";

type Branch = { id: string; name: string; timezone: string; active: boolean };
type BreakRule = { id: string; code: string; name: string; counts_as_work: boolean; required: boolean; max_minutes: number | null; requires_qr: boolean };
type BreakRow = { id: string; template_day_id: string; break_rule_id: string; planned_start_local: string; planned_end_local: string; planned_minutes: number; rule: BreakRule | null };
type ScheduleDay = { id: string; iso_weekday: number; start_local: string | null; end_local: string | null; scheduled_minutes: number; breaks: BreakRow[] };
type Schedule = { id: string; branch_id: string; name: string; kind: "fixed" | "variable"; active: boolean; workday_type: "day" | "night" | "mixed"; entry_tolerance_minutes: number; effective_from: string; effective_to: string | null; revision_of: string | null; days: ScheduleDay[] };
type Employee = { id: string; employee_number: string; first_name: string; last_name: string; branch_id: string | null; active: boolean };
type ScheduleAssignment = { id: string; employee_id: string; template_id: string | null; branch_id: string; starts_on: string; ends_on: string | null };
type Payload = { error?: { message?: string }; branches?: Branch[]; employees?: Employee[]; items?: Schedule[]; item?: { id?: string } };
type DraftBreak = { id: string; name: string; start: string; end: string; countsAsWork: boolean; requiresQr: boolean; required: boolean; maxMinutes: string };
type DraftDay = WeekDraft<DraftBreak>[WeekdayNumber];
type RuleRow = { id: string; name: string; effective_from: string; effective_to: string | null; settings: Record<string, unknown> };
type CalendarPayload = { weekStart: string; weekEnd: string; branches: Branch[]; days: Array<{ date: string; weekday: number; rows: Array<{ employee: { id: string; employeeNumber: string; name: string }; branch: Branch | null; assignment: { id: string; templateName: string; timezone: string; kind: string; workdayType: string; toleranceMinutes: number } | null; schedule: { start: string | null; end: string | null; plannedMinutes: number } | null; isRestDay: boolean }> }> };

const weekdayNames = ISO_WEEKDAYS.map((day) => day.label);
const inputClass = "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100";
const buttonPrimary = "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50";
const buttonSecondary = "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";
const currentDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const offsetDate = (value: string, offset: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const weekMonday = (value: string) => {
  const date = new Date(`${value}T12:00:00`);
  return offsetDate(value, -(date.getDay() + 6) % 7);
};
const hm = (value: string | null | undefined) => value?.slice(0, 5) ?? "—";
const hours = (minutes: number | null | undefined) => minutes == null ? "—" : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;

function messageFrom(response: Response, payload: { error?: { message?: string } }) {
  if (!response.ok) throw new Error(payload.error?.message ?? "No fue posible completar la solicitud.");
}

export function ScheduleManagement({ employeeId }: { employeeId?: string }) {
  const { company } = useAdminContext();
  const [tab, setTab] = useState<"shifts" | "assignments" | "calendar" | "rules">(employeeId ? "assignments" : "shifts");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [calendar, setCalendar] = useState<CalendarPayload | null>(null);
  const [calendarWeek, setCalendarWeek] = useState(() => weekMonday(currentDate()));
  const [selectedBranch, setSelectedBranch] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignmentBranch, setAssignmentBranch] = useState("");
  const [assignmentTemplateId, setAssignmentTemplateId] = useState("");
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>(() => employeeId ? [employeeId] : []);
  const [assignmentHistoryOpen, setAssignmentHistoryOpen] = useState(false);
  const [closingRuleId, setClosingRuleId] = useState<string | null>(null);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [scheduleDeleteCandidate, setScheduleDeleteCandidate] = useState<Schedule | null>(null);
  const [scheduleDeleteBlocked, setScheduleDeleteBlocked] = useState("");
  const [ruleDeleteCandidate, setRuleDeleteCandidate] = useState<RuleRow | null>(null);
  const [ruleDeleteBlocked, setRuleDeleteBlocked] = useState("");

  const query = useMemo(() => new URLSearchParams({ companyId: company.companyId }), [company.companyId]);
  const activeBranches = branches.filter((branch) => branch.active);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  const loadBase = useCallback(async (signal?: AbortSignal) => {
    const [response, assignmentResponse] = await Promise.all([
      fetch(`/api/schedules?${query}`, { cache: "no-store", signal }),
      fetch(`/api/schedules/assignments?${query}`, { cache: "no-store", signal }),
    ]);
    const [payload, assignmentPayload] = await Promise.all([
      response.json() as Promise<Payload>,
      assignmentResponse.json() as Promise<{ items?: ScheduleAssignment[]; error?: { message?: string } }>,
    ]);
    messageFrom(response, payload);
    messageFrom(assignmentResponse, assignmentPayload);
    setBranches(payload.branches ?? []);
    setEmployees(payload.employees ?? []);
    setSchedules(payload.items ?? []);
    setAssignments(assignmentPayload.items ?? []);
    if (payload.branches?.length && !selectedBranch) setSelectedBranch(payload.branches.find((branch) => branch.active)?.id ?? "");
    if (payload.branches?.length && !assignmentBranch) {
      const employeeBranchId = employeeId ? payload.employees?.find((employee) => employee.id === employeeId)?.branch_id : null;
      setAssignmentBranch(employeeBranchId ?? payload.branches.find((branch) => branch.active)?.id ?? "");
    }
  }, [query, selectedBranch, assignmentBranch, employeeId]);

  const loadRules = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/schedules/rules?${query}`, { cache: "no-store", signal });
    const payload = await response.json() as { items?: RuleRow[]; error?: { message?: string } };
    messageFrom(response, payload);
    setRules(payload.items ?? []);
  }, [query]);

  const loadCalendar = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams(query);
    params.set("weekStart", calendarWeek);
    if (selectedBranch) params.set("branchId", selectedBranch);
    const response = await fetch(`/api/schedules/calendar?${params}`, { cache: "no-store", signal });
    const payload = await response.json() as CalendarPayload & { error?: { message?: string } };
    messageFrom(response, payload);
    setCalendar(payload);
  }, [calendarWeek, query, selectedBranch]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try { await loadBase(); if (tab === "rules") await loadRules(); if (tab === "calendar") await loadCalendar(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Ocurrió un error al actualizar."); }
    finally { setRefreshing(false); }
  }, [loadBase, loadCalendar, loadRules, tab]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void Promise.all([loadBase(controller.signal), loadRules(controller.signal)])
        .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No fue posible cargar el módulo."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [company.companyId, loadBase, loadRules]);

  useEffect(() => {
    if (tab !== "calendar" || !activeBranches.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadCalendar(controller.signal).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No fue posible cargar el calendario."); }); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeBranches.length, loadCalendar, tab]);

  async function saveSchedule(body: Record<string, unknown>) {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/schedules?${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as Payload;
      messageFrom(response, payload);
      await loadBase();
      setEditing(null); setDialogOpen(false);
      createButtonRef.current?.focus();
      if (!body.revisionOf && payload.item?.id) {
        setAssignmentTemplateId(payload.item.id);
        setAssignmentBranch(String(body.branchId ?? ""));
        setAssignmentSearch("");
        setTab("assignments");
        setNotice("Horario creado. Si quieres, ahora puedes asignarlo a empleados.");
      } else {
        setNotice("Se creó una nueva versión. Las asignaciones e historial anteriores se conservaron.");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible guardar el horario."); }
    finally { setSaving(false); }
  }

  async function setScheduleActive(schedule: Schedule) {
    setError(""); setNotice("");
    try {
      const response = await fetch(`/api/schedules/${schedule.id}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !schedule.active }) });
      const payload = await response.json() as Payload;
      messageFrom(response, payload); await loadBase();
      setNotice(schedule.active ? "Horario desactivado. Las asignaciones previas siguen vigentes." : "Horario activado.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible cambiar el estado."); }
  }

  async function deleteSchedule(schedule: Schedule) {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/schedules/${schedule.id}?${query}`, { method: "DELETE" });
      const payload = await response.json() as Payload;
      if (response.status === 409) { setScheduleDeleteBlocked(payload.error?.message ?? "El horario tiene referencias y debe conservarse."); return; }
      messageFrom(response, payload);
      await loadBase();
      setScheduleDeleteCandidate(null); setScheduleDeleteBlocked("");
      setNotice(`Se eliminó el horario “${schedule.name}”.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible eliminar el horario."); }
    finally { setSaving(false); }
  }

  async function archiveBlockedSchedule(schedule: Schedule) {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/schedules/${schedule.id}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) });
      const payload = await response.json() as Payload;
      messageFrom(response, payload);
      await loadBase(); setScheduleDeleteCandidate(null); setScheduleDeleteBlocked("");
      setNotice(`El horario “${schedule.name}” quedó desactivado; sus asignaciones e historial se conservaron.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible desactivar el horario."); }
    finally { setSaving(false); }
  }

  async function saveAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const employeeIds = selectedEmployeeIds;
    try {
      const response = await fetch(`/api/schedules/assignments?${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId: String(form.get("branchId") ?? ""), templateId: String(form.get("templateId") ?? ""), employeeIds, startsOn: String(form.get("startsOn") ?? ""), endsOn: String(form.get("endsOn") ?? "") || null }) });
      const payload = await response.json() as { items?: unknown[]; error?: { message?: string } };
      messageFrom(response, payload);
      await Promise.all([loadBase(), tab === "calendar" ? loadCalendar() : Promise.resolve()]);
      setNotice(`${payload.items?.length ?? employeeIds.length} asignación(es) guardada(s). El horario previo se cerró al inicio de la nueva vigencia.`);
      formElement.reset();
      setSelectedEmployeeIds([]); setAssignmentSearch("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible crear la asignación."); }
    finally { setSaving(false); }
  }

  async function saveLaborRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/schedules/rules?${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: String(form.get("name") ?? "").trim(), effectiveFrom: String(form.get("effectiveFrom") ?? ""), effectiveTo: String(form.get("effectiveTo") ?? "") || null,
        lateGraceMinutes: Number(form.get("lateGraceMinutes")), earlyDepartureGraceMinutes: Number(form.get("earlyDepartureGraceMinutes")),
        restWeekdays: form.getAll("restWeekdays").map(Number), dayStartsAt: String(form.get("dayStartsAt")), nightStartsAt: String(form.get("nightStartsAt")),
        overtimeDetection: form.get("overtimeDetection") === "on", overtimeThresholdMinutes: Number(form.get("overtimeThresholdMinutes")), overtimeRecognition: String(form.get("overtimeRecognition")),
      }) });
      const payload = await response.json() as { error?: { message?: string } };
      messageFrom(response, payload); await loadRules(); setRuleFormOpen(false); setNotice("La regla laboral quedó registrada con su periodo de vigencia.");
      formElement.reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible guardar la regla laboral."); }
    finally { setSaving(false); }
  }

  async function closeLaborRule(event: FormEvent<HTMLFormElement>, ruleId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/schedules/rules/${ruleId}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effectiveTo: String(form.get("effectiveTo") ?? "") }) });
      const payload = await response.json() as { error?: { message?: string } };
      messageFrom(response, payload);
      await loadRules(); setClosingRuleId(null); setNotice("La fecha final quedó registrada. La regla y su historial se conservaron.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible cerrar la vigencia."); }
    finally { setSaving(false); }
  }

  async function deleteLaborRule(rule: RuleRow) {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/schedules/rules/${rule.id}?${query}`, { method: "DELETE" });
      const payload = await response.json() as { error?: { message?: string } };
      if (response.status === 409) { setRuleDeleteBlocked(payload.error?.message ?? "La regla está vinculada a datos históricos y debe conservarse."); return; }
      messageFrom(response, payload);
      await loadRules(); setRuleDeleteCandidate(null); setRuleDeleteBlocked("");
      setNotice(`Se eliminó la regla laboral “${rule.name}”.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible eliminar la regla laboral."); }
    finally { setSaving(false); }
  }

  async function closeBlockedLaborRule(rule: RuleRow) {
    setSaving(true); setError(""); setNotice("");
    try {
      const effectiveTo = rule.effective_from > currentDate() ? rule.effective_from : currentDate();
      const response = await fetch(`/api/schedules/rules/${rule.id}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effectiveTo }) });
      const payload = await response.json() as { error?: { message?: string } };
      messageFrom(response, payload);
      await loadRules(); setRuleDeleteCandidate(null); setRuleDeleteBlocked("");
      setNotice(`La vigencia de “${rule.name}” quedó finalizada al ${effectiveTo}; se conservaron sus referencias históricas.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible finalizar la vigencia."); }
    finally { setSaving(false); }
  }

  const visibleSchedules = schedules.filter((item) => (!selectedBranch || item.branch_id === selectedBranch) && item.name.toLocaleLowerCase("es-MX").includes(search.toLocaleLowerCase("es-MX")));
  const assignEmployees = employees.filter((employee) => employee.active && employee.branch_id === assignmentBranch && `${employee.first_name} ${employee.last_name} ${employee.employee_number}`.toLocaleLowerCase("es-MX").includes(assignmentSearch.toLocaleLowerCase("es-MX")));
  const activeTemplates = schedules.filter((item) => item.active && (!assignmentBranch || item.branch_id === assignmentBranch));
  const tabs = [["shifts", "Horarios", CalendarClock], ["assignments", "Asignar empleados", Users]] as const;

  if (loading) return <div className="mx-auto max-w-7xl animate-pulse space-y-5"><div className="h-8 w-64 rounded bg-slate-200" /><div className="h-16 rounded-2xl bg-white" /><div className="h-[30rem] rounded-2xl bg-white" /></div>;

  return <main className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Control de jornada</p><h1 className="mt-1 text-2xl font-bold text-slate-950">Horarios</h1><p className="mt-1 text-sm text-slate-500">Crea turnos y asígnalos al personal de {company.companyName}.</p></div><div className="flex flex-wrap items-center gap-2"><label className="relative min-w-52"><span className="sr-only">Filtrar por sucursal</span><MapPin size={15} className="absolute left-3 top-3 text-slate-400" /><select aria-label="Filtrar por sucursal" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-xs font-semibold text-slate-700 outline-none focus:border-blue-400"><option value="">Todas las sucursales</option>{activeBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-slate-400" /></label><button onClick={() => void refresh()} disabled={refreshing} className={buttonSecondary}><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />Actualizar</button></div></header>

    {notice ? <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><Check size={16} className="mt-0.5 shrink-0" />{notice}</div> : null}
    {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</div> : null}

    {!activeBranches.length ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-7"><div className="flex gap-3"><MapPin size={20} className="mt-0.5 shrink-0 text-amber-700" /><div className="flex-1"><h2 className="text-sm font-bold text-amber-950">Primero configura una sucursal</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-amber-900/80">Los horarios necesitan una sucursal y su zona horaria para calcular correctamente cada jornada.</p><Link href="/admin/configuracion" className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white hover:bg-blue-900">Ir a Configuración</Link></div></div></section> : null}

    <div className="flex flex-wrap items-center gap-2"><nav aria-label="Tareas frecuentes de horarios" className="flex flex-wrap gap-2">{tabs.map(([id, label, Icon]) => <button key={id} onClick={() => { setTab(id); setError(""); }} aria-pressed={tab === id} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-xs font-semibold transition ${tab === id ? "border-[#14264a] bg-[#14264a] text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}><Icon size={15} />{label}</button>)}</nav><details className="group relative"><summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><CalendarDays size={15} />Más opciones</summary><div className="absolute left-0 z-20 mt-2 flex w-60 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"><button type="button" onClick={() => { setTab("calendar"); setError(""); }} className="rounded-lg px-3 py-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">Calendario semanal</button><button type="button" onClick={() => { setTab("rules"); setError(""); }} className="rounded-lg px-3 py-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">Reglas laborales</button><button type="button" onClick={() => { setTab("assignments"); setAssignmentHistoryOpen(true); }} className="rounded-lg px-3 py-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">Historial de asignaciones</button></div></details></div>

    {tab === "shifts" ? <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm"><div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center"><div><h2 className="text-sm font-bold text-slate-900">Horarios de la empresa</h2><p className="mt-1 text-xs text-slate-500">Los turnos previos se conservan al crear una nueva versión.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><input aria-label="Buscar horarios" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar horario" className="h-10 rounded-xl border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-blue-400" /></label><button ref={createButtonRef} onClick={() => { setError(""); setEditing(null); setDialogOpen(true); }} disabled={!activeBranches.length} className={buttonPrimary}><Plus size={15} />Crear horario</button></div></div>
      {!visibleSchedules.length ? <EmptyState icon={<CalendarClock size={21} />} title={search ? "No encontramos horarios" : "Aún no hay horarios"} description={search ? "Prueba con otro nombre o sucursal." : "Crea el primer horario con los días y horas que necesita tu equipo."} /> : <div className="divide-y divide-slate-100">{visibleSchedules.map((schedule) => <ScheduleCard key={schedule.id} schedule={schedule} branch={branches.find((item) => item.id === schedule.branch_id)} employees={employees} assignments={assignments} onAssign={() => { setAssignmentBranch(schedule.branch_id); setAssignmentTemplateId(schedule.id); setAssignmentSearch(""); setTab("assignments"); }} onEdit={() => { setEditing(schedule); setDialogOpen(true); setError(""); }} onActive={() => void setScheduleActive(schedule)} onDelete={() => { setScheduleDeleteBlocked(""); setScheduleDeleteCandidate(schedule); }} />)}</div>}</section> : null}

    {tab === "assignments" ? <section className="grid gap-5 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]"><section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Users size={18} /></span><div><h2 className="text-sm font-bold text-slate-900">Asignar horario</h2><p className="mt-1 text-xs text-slate-500">Elige una sucursal, un horario y las personas que lo usarán.</p></div></div>{!activeTemplates.length ? <p className="mt-5 rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-500">Crea un horario activo en la sucursal elegida para habilitar asignaciones.</p> : <form onSubmit={saveAssignment} className="mt-5 space-y-4"><label className="block text-xs font-semibold text-slate-700">Sucursal<select required name="branchId" value={assignmentBranch} onChange={(event) => { setAssignmentBranch(event.target.value); setAssignmentTemplateId(""); setSelectedEmployeeIds([]); }} className={inputClass}>{activeBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label className="block text-xs font-semibold text-slate-700">Horario<select required name="templateId" value={assignmentTemplateId} onChange={(event) => setAssignmentTemplateId(event.target.value)} className={inputClass}><option value="">Selecciona un horario</option>{activeTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-xs font-semibold text-slate-700">Inicia el<input required type="date" name="startsOn" defaultValue={currentDate()} className={inputClass} /></label><label className="block text-xs font-semibold text-slate-700">Termina el (opcional)<input type="date" name="endsOn" className={inputClass} /><span className="mt-1 block text-[11px] font-normal text-slate-400">Déjala vacía para una asignación abierta.</span></label><fieldset><legend className="text-xs font-semibold text-slate-700">Empleados de {branches.find((branch) => branch.id === assignmentBranch)?.name ?? "la sucursal"}</legend><label className="relative mt-2 block"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><input type="search" value={assignmentSearch} onChange={(event) => setAssignmentSearch(event.target.value)} placeholder="Buscar por nombre" aria-label="Buscar empleados por nombre" className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-blue-400" /></label><div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">{assignEmployees.length ? assignEmployees.map((employee) => <label key={employee.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 text-xs hover:bg-slate-50"><input type="checkbox" name="employeeIds" value={employee.id} checked={selectedEmployeeIds.includes(employee.id)} onChange={(event) => setSelectedEmployeeIds((current) => event.target.checked ? current.includes(employee.id) || current.length >= 100 ? current : [...current, employee.id] : current.filter((id) => id !== employee.id))} className="size-4 rounded border-slate-300 text-blue-700 focus:ring-blue-500" /><span className="min-w-0 flex-1 truncate font-medium text-slate-800">{employee.first_name} {employee.last_name}</span><span className="text-right text-[10px] text-slate-400">{branches.find((branch) => branch.id === employee.branch_id)?.name ?? "Sin sucursal"}<span className="block">{employee.employee_number}</span></span></label>) : <p className="px-2 py-3 text-xs text-slate-500">No hay empleados activos disponibles en esta sucursal.</p>}</div><p className="mt-2 text-[11px] text-slate-500">{selectedEmployeeIds.length} seleccionados · máximo 100 por asignación</p>{selectedEmployeeIds.length >= 100 ? <p className="mt-1 text-[11px] text-amber-700">Para asignar a más personas, guarda esta selección y crea otra asignación.</p> : null}</fieldset><button disabled={saving || !assignEmployees.length || !selectedEmployeeIds.length || !assignmentTemplateId} className={`${buttonPrimary} w-full`}>{saving ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}Guardar asignación</button></form>}</section><details open={assignmentHistoryOpen} onToggle={(event) => setAssignmentHistoryOpen(event.currentTarget.open)} className="group self-start"><summary className="cursor-pointer text-xs font-semibold text-blue-800">Consultar historial de asignaciones</summary><div className="mt-3"><AssignmentHistory schedules={schedules} query={query} /></div></details></section> : null}

    {tab === "calendar" ? <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="text-sm font-bold text-slate-900">Calendario semanal</h2><p className="mt-1 text-xs text-slate-500">Turnos por zona horaria de la sucursal · {calendar?.weekStart ?? calendarWeek} — {calendar?.weekEnd ?? offsetDate(calendarWeek, 6)}</p></div><div className="flex gap-2"><button aria-label="Semana anterior" className={buttonSecondary} onClick={() => setCalendarWeek((week) => offsetDate(week, -7))}><ArrowLeft size={15} />Anterior</button><button className={buttonSecondary} onClick={() => setCalendarWeek(weekMonday(currentDate()))}>Esta semana</button><button aria-label="Semana siguiente" className={buttonSecondary} onClick={() => setCalendarWeek((week) => offsetDate(week, 7))}>Siguiente<ArrowRight size={15} /></button></div></div>{!calendar?.days ? <div className="p-8 text-center text-xs text-slate-500">Cargando calendario…</div> : <div className="grid min-w-[1050px] grid-cols-7 divide-x divide-slate-100">{calendar.days.map((day) => <div key={day.date} className="min-h-72"><div className="border-b border-slate-100 bg-slate-50/70 px-3 py-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{weekdayNames[day.weekday - 1]}</p><p className="mt-0.5 text-xs font-bold text-slate-800">{new Date(`${day.date}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</p></div><div className="space-y-2 p-2">{day.rows.length ? day.rows.map((row) => <article key={`${day.date}:${row.employee.id}`} className={`rounded-xl border p-2.5 ${row.schedule ? "border-blue-100 bg-blue-50/50" : row.isRestDay ? "border-slate-100 bg-slate-50" : "border-amber-100 bg-amber-50/60"}`}><p className="truncate text-[11px] font-semibold text-slate-800" title={row.employee.name}>{row.employee.name}</p>{row.schedule ? <><p className="mt-1 text-[10px] font-semibold text-blue-800">{hm(row.schedule.start)}–{hm(row.schedule.end)}</p><p className="mt-1 truncate text-[10px] text-slate-500">{row.assignment?.templateName}</p><p className="mt-1 text-[9px] text-slate-400">{row.branch?.name ?? "Sin sucursal"}</p></> : row.isRestDay ? <p className="mt-1 text-[10px] text-slate-500">Día de descanso</p> : <p className="mt-1 text-[10px] text-amber-700">Sin asignación</p>}</article>) : <p className="px-1 py-2 text-[10px] text-slate-400">Sin empleados</p>}</div></div>)}</div>}</section> : null}

    {tab === "rules" ? <section className="grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]"><section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-bold text-slate-900">Reglas laborales</h2><p className="mt-1 text-xs text-slate-500">Los valores se versionan por vigencia y no fijan límites legales en el código.</p></div><button onClick={() => setRuleFormOpen(!ruleFormOpen)} className={buttonPrimary}><Plus size={14} />Nueva regla</button></div>{ruleFormOpen ? <form onSubmit={saveLaborRule} className="mt-5 space-y-3 rounded-xl border border-slate-100 bg-slate-50/70 p-4"><label className="block text-xs font-semibold text-slate-700">Nombre<input required name="name" maxLength={120} placeholder="Ej. Reglas operativas 2026" className={inputClass} /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-700">Vigente desde<input required type="date" name="effectiveFrom" defaultValue={currentDate()} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Hasta (opcional)<input type="date" name="effectiveTo" className={inputClass} /></label></div><p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Clasificación configurable de jornada</p><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-700">Inicio diurno<input required type="time" name="dayStartsAt" defaultValue="06:00" className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Inicio nocturno<input required type="time" name="nightStartsAt" defaultValue="20:00" className={inputClass} /></label></div><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-700">Tolerancia de retardo (min)<input required type="number" min={0} max={1440} name="lateGraceMinutes" defaultValue={0} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Tolerancia de salida anticipada (min)<input required type="number" min={0} max={1440} name="earlyDepartureGraceMinutes" defaultValue={0} className={inputClass} /></label></div><fieldset><legend className="text-xs font-semibold text-slate-700">Días de descanso</legend><div className="mt-2 flex flex-wrap gap-2">{weekdayNames.map((day, index) => <label key={day} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-600"><input name="restWeekdays" type="checkbox" value={index + 1} className="size-3.5 rounded border-slate-300 text-blue-700" />{day.slice(0, 3)}</label>)}</div></fieldset><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-700">Umbral de excedente (min)<input required type="number" min={0} max={1440} name="overtimeThresholdMinutes" defaultValue={0} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Reconocimiento<select name="overtimeRecognition" className={inputClass}><option value="authorization_only">Solo con autorización</option><option value="configured_rules">Reglas configurables</option></select></label></div><label className="flex items-start gap-2 rounded-lg bg-white p-3 text-xs text-slate-600"><input type="checkbox" name="overtimeDetection" defaultChecked className="mt-0.5 size-4 rounded border-slate-300 text-blue-700" /><span>Detectar tiempo excedente al comparar el trabajo efectivo con el tiempo programado.</span></label><button disabled={saving} className={`${buttonPrimary} w-full`}>{saving ? "Guardando…" : "Guardar regla vigente"}</button></form> : null}</section><section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><h3 className="text-sm font-bold text-slate-900">Versiones configuradas</h3><p className="mt-1 text-xs text-slate-500">No se permite superponer periodos vigentes en la misma empresa.</p></div>{rules.length ? <div className="divide-y divide-slate-100">{rules.map((rule) => <article key={rule.id} className="p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-semibold text-slate-800">{rule.name}</h4><p className="mt-1 text-[11px] text-slate-500">Vigencia: {rule.effective_from} · {rule.effective_to ?? "sin fecha final"}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">Configurada</span><button type="button" aria-label={`Eliminar regla ${rule.name}`} title="Eliminar regla laboral" disabled={saving} onClick={() => { setRuleDeleteBlocked(""); setRuleDeleteCandidate(rule); }} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={14} /><span className="hidden sm:inline">Eliminar</span></button></div><div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2"><p>Retardo: {String(rule.settings.lateGraceMinutes ?? 0)} min</p><p>Salida anticipada: {String(rule.settings.earlyDepartureGraceMinutes ?? 0)} min</p><p>Detección de excedente: {String((rule.settings.overtime as Record<string, unknown> | undefined)?.detectionEnabled ? "Activada" : "Desactivada")}</p><p>Reconocimiento: {String((rule.settings.overtime as Record<string, unknown> | undefined)?.recognitionPolicy ?? "Solo autorización")}</p></div>{rule.effective_to === null ? closingRuleId === rule.id ? <form onSubmit={(event) => void closeLaborRule(event, rule.id)} className="mt-4 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3"><label className="text-[11px] font-semibold text-slate-600">Cerrar vigencia al<input required type="date" name="effectiveTo" min={rule.effective_from} max={currentDate()} defaultValue={currentDate()} className="mt-1 block h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs" /></label><button disabled={saving} className={buttonPrimary}>{saving ? "Guardando…" : "Guardar fecha final"}</button><button type="button" onClick={() => setClosingRuleId(null)} className={buttonSecondary}>Cancelar</button></form> : <button onClick={() => setClosingRuleId(rule.id)} className="mt-4 h-9 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">Definir fecha final de vigencia</button> : null}</article>)}</div> : <EmptyState icon={<ShieldCheck size={21} />} title="Sin reglas configuradas" description="Agrega una versión con fecha de vigencia y valores definidos por la empresa." />}</section></section> : null}

    {scheduleDeleteCandidate ? <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4" role="presentation"><section role="alertdialog" aria-modal="true" aria-labelledby="delete-schedule-title" aria-describedby="delete-schedule-description" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700"><Trash2 size={18} /></span><div><h2 id="delete-schedule-title" className="text-base font-bold text-slate-950">Eliminar horario</h2><p className="mt-1 text-sm font-semibold text-slate-700">“{scheduleDeleteCandidate.name}”</p></div></div><p id="delete-schedule-description" className="mt-4 text-xs leading-relaxed text-slate-600">Se intentará eliminarlo definitivamente. Si tiene asignaciones, versiones derivadas o jornadas asociadas, el servidor bloqueará el borrado y podrás desactivarlo para conservar el historial.</p>{scheduleDeleteBlocked ? <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{scheduleDeleteBlocked}</p> : null}<div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={saving} onClick={() => { setScheduleDeleteCandidate(null); setScheduleDeleteBlocked(""); }} className={buttonSecondary}>Cancelar</button>{scheduleDeleteBlocked && scheduleDeleteCandidate.active ? <button type="button" disabled={saving} onClick={() => void archiveBlockedSchedule(scheduleDeleteCandidate)} className={buttonSecondary}>{saving ? <LoaderCircle size={14} className="animate-spin" /> : null}Desactivar y conservar historial</button> : null}{scheduleDeleteBlocked && !scheduleDeleteCandidate.active ? <span className="self-center text-[11px] text-slate-500">Ya está desactivado y conserva sus referencias.</span> : null}{!scheduleDeleteBlocked ? <button type="button" disabled={saving} onClick={() => void deleteSchedule(scheduleDeleteCandidate)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50">{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}{saving ? "Procesando…" : "Eliminar definitivamente"}</button> : null}</div></section></div> : null}
    {ruleDeleteCandidate ? <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4" role="presentation"><section role="alertdialog" aria-modal="true" aria-labelledby="delete-rule-title" aria-describedby="delete-rule-description" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700"><Trash2 size={18} /></span><div><h2 id="delete-rule-title" className="text-base font-bold text-slate-950">Eliminar regla laboral</h2><p className="mt-1 text-sm font-semibold text-slate-700">“{ruleDeleteCandidate.name}”</p></div></div><p id="delete-rule-description" className="mt-4 text-xs leading-relaxed text-slate-600">Se intentará eliminarla definitivamente. Las reglas asociadas a jornadas o cálculos no se borran para proteger el historial.</p>{ruleDeleteBlocked ? <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{ruleDeleteBlocked}</p> : null}<div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={saving} onClick={() => { setRuleDeleteCandidate(null); setRuleDeleteBlocked(""); }} className={buttonSecondary}>Cancelar</button>{ruleDeleteBlocked && ruleDeleteCandidate.effective_to === null ? <button type="button" disabled={saving} onClick={() => void closeBlockedLaborRule(ruleDeleteCandidate)} className={buttonSecondary}>{saving ? <LoaderCircle size={14} className="animate-spin" /> : null}Finalizar vigencia</button> : null}{ruleDeleteBlocked && ruleDeleteCandidate.effective_to !== null ? <span className="self-center text-[11px] text-slate-500">La vigencia ya está cerrada; su historial se conserva.</span> : null}{!ruleDeleteBlocked ? <button type="button" disabled={saving} onClick={() => void deleteLaborRule(ruleDeleteCandidate)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50">{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}{saving ? "Procesando…" : "Eliminar definitivamente"}</button> : null}</div></section></div> : null}
    {dialogOpen ? <ScheduleDialog key={editing?.id ?? "new"} initial={editing} branches={activeBranches} saving={saving} onClose={() => { setDialogOpen(false); setEditing(null); }} onSave={(body) => void saveSchedule(body)} /> : null}
  </main>;
}

function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="px-6 py-14 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-50 text-slate-400">{icon}</div><p className="mt-4 text-sm font-semibold text-slate-800">{title}</p><p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">{description}</p></div>;
}

function ScheduleCard({ schedule, branch, employees, assignments, onAssign, onEdit, onActive, onDelete }: { schedule: Schedule; branch?: Branch; employees: Employee[]; assignments: ScheduleAssignment[]; onAssign: () => void; onEdit: () => void; onActive: () => void; onDelete: () => void }) {
  const days = [...schedule.days].sort((a, b) => a.iso_weekday - b.iso_weekday);
  const today = currentDate();
  const assigned = assignments.filter((item) => item.template_id === schedule.id && item.starts_on <= today && (!item.ends_on || item.ends_on >= today)).map((item) => employees.find((employee) => employee.id === item.employee_id)).filter((employee): employee is Employee => Boolean(employee));
  const uniqueEmployees = [...new Map(assigned.map((employee) => [employee.id, employee])).values()];
  return <article className="p-5"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold text-slate-900">{schedule.name}</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${schedule.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{schedule.active ? "Activo" : "Inactivo"}</span><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700">{schedule.workday_type === "day" ? "Diurna" : schedule.workday_type === "night" ? "Nocturna" : "Mixta"}</span>{schedule.revision_of ? <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700">Nueva versión</span> : null}</div><p className="mt-1 text-[11px] text-slate-500">{branch?.name ?? "Sucursal"} · tolerancia {schedule.entry_tolerance_minutes} min · vigencia {schedule.effective_from} – {schedule.effective_to ?? "abierta"}</p><p className="mt-2 text-xs text-slate-600"><span className="font-semibold">Personal asignado:</span> {uniqueEmployees.length ? `${uniqueEmployees.slice(0, 3).map((employee) => `${employee.first_name} ${employee.last_name}`).join(", ")}${uniqueEmployees.length > 3 ? ` y ${uniqueEmployees.length - 3} más` : ""}` : "Sin asignaciones vigentes"}</p><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{days.map((day) => <div key={day.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{weekdayNames[day.iso_weekday - 1]}</p><p className="mt-1 text-xs font-semibold text-slate-800">{hm(day.start_local)} – {hm(day.end_local)} <span className="text-slate-400">· {hours(day.scheduled_minutes)}</span></p>{day.breaks.map((item) => <p key={item.id} className="mt-1 flex items-center gap-1 text-[10px] text-slate-500"><Coffee size={11} />{item.rule?.name ?? "Descanso"} {hm(item.planned_start_local)}–{hm(item.planned_end_local)} · {item.rule?.counts_as_work ? "computable" : "no computable"}</p>)}</div>)}</div></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" className={buttonPrimary} onClick={onAssign}><Users size={14} />Asignar empleados</button><button type="button" className={buttonSecondary} onClick={onEdit}><Pencil size={14} />Editar horario</button><button type="button" className={buttonSecondary} onClick={onActive}>{schedule.active ? "Desactivar" : "Activar"}</button><button type="button" aria-label={`Eliminar horario ${schedule.name}`} title="Eliminar horario" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" onClick={onDelete}><Trash2 size={14} /><span className="hidden sm:inline">Eliminar</span></button></div></div></article>;
}

function ScheduleDialog({ initial, branches, saving, onClose, onSave }: { initial: Schedule | null; branches: Branch[]; saving: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [days, setDays] = useState<WeekDraft<DraftBreak>>(() => createWeekDraft((initial?.days ?? []).map((day) => ({
    iso_weekday: day.iso_weekday, start: hm(day.start_local) === "—" ? "09:00" : hm(day.start_local), end: hm(day.end_local) === "—" ? "17:00" : hm(day.end_local),
    breaks: day.breaks.map((item) => ({ id: item.id, name: item.rule?.name ?? "Descanso", start: hm(item.planned_start_local), end: hm(item.planned_end_local), countsAsWork: item.rule?.counts_as_work ?? false, requiresQr: item.rule?.requires_qr ?? true, required: item.rule?.required ?? false, maxMinutes: item.rule?.max_minutes == null ? "" : String(item.rule.max_minutes) })),
  }))));
  const enabled = getEnabledWeekdays(days);
  const [commonStart, setCommonStart] = useState(enabled[0]?.start ?? "09:00");
  const [commonEnd, setCommonEnd] = useState(enabled[0]?.end ?? "17:00");
  const [localError, setLocalError] = useState("");
  const [dirty, setDirty] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const branchDefault = branches.find((branch) => branch.id === initial?.branch_id)?.id ?? branches[0]?.id ?? "";
  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Quieres cerrar el formulario y descartarlos?")) return;
    onClose();
  }, [dirty, onClose, saving]);
  useEffect(() => {
    const firstInput = dialogRef.current?.querySelector<HTMLElement>("input:not([type=checkbox]), select, button");
    firstInput?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); requestClose(); }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);
  function toggleDay(weekday: WeekdayNumber) {
    setDirty(true);
    setDays((items) => {
      const next = toggleWeekday(items, weekday);
      return next[weekday].enabled ? patchWeekday(next, weekday, { start: commonStart, end: commonEnd }) : next;
    });
  }
  function updateDay(weekday: WeekdayNumber, update: Partial<DraftDay>) { setDirty(true); setDays((items) => patchWeekday(items, weekday, update)); }
  function updateBreak(weekday: WeekdayNumber, breakId: string, update: Partial<DraftBreak>) { setDirty(true); setDays((items) => patchWeekday(items, weekday, { breaks: items[weekday].breaks.map((item) => item.id === breakId ? { ...item, ...update } : item) })); }
  function updateCommonTime(field: "start" | "end", value: string) {
    setDirty(true);
    if (field === "start") setCommonStart(value); else setCommonEnd(value);
    setDays((items) => ISO_WEEKDAYS.reduce((next, day) => items[day.isoWeekday].enabled ? patchWeekday(next, day.isoWeekday, { [field]: value }) : next, items));
  }
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLocalError("");
    const enabledDays = getEnabledWeekdays(days);
    if (!enabledDays.length) { setLocalError("Selecciona al menos un día laboral."); return; }
    const data = new FormData(event.currentTarget);
    onSave({ branchId: String(data.get("branchId") ?? ""), name: String(data.get("name") ?? "").trim(), kind: String(data.get("kind") ?? "fixed"), workdayType: String(data.get("workdayType") ?? "day"), entryToleranceMinutes: Number(data.get("entryToleranceMinutes")), effectiveFrom: String(data.get("effectiveFrom") ?? ""), effectiveTo: String(data.get("effectiveTo") ?? "") || null, revisionOf: initial?.id ?? null,
      days: enabledDays.map((day) => ({ weekday: day.weekday, start: day.start, end: day.end, breaks: day.breaks.map((item) => ({ name: item.name, start: item.start, end: item.end, countsAsWork: item.countsAsWork, requiresQr: item.requiresQr, required: item.required, maxMinutes: item.maxMinutes ? Number(item.maxMinutes) : null })) })),
    });
  }
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="schedule-dialog-title" tabIndex={-1} className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"><div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-7"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">{initial ? "Nueva versión" : "Nuevo horario"}</p><h2 id="schedule-dialog-title" className="mt-1 text-lg font-bold text-slate-950">{initial ? `Editar ${initial.name}` : "Crear horario"}</h2><p className="mt-1 text-xs text-slate-500">Elige los días y las horas. Las versiones anteriores y sus registros se conservan.</p></div><button type="button" aria-label="Cerrar" disabled={saving} onClick={requestClose} className="grid size-9 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X size={18} /></button></div><form onChange={() => setDirty(true)} onSubmit={onSubmit} className="space-y-6 p-5 sm:p-7">
    {localError ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{localError}</p> : null}
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Nombre del horario<input required name="name" defaultValue={initial?.name ?? ""} maxLength={120} className={inputClass} placeholder="Ej. Turno de mañana" /></label><label className="text-xs font-semibold text-slate-700">Sucursal<select required name="branchId" defaultValue={branchDefault} className={inputClass}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.timezone}</option>)}</select></label></div>
    <fieldset><legend className="text-xs font-bold text-slate-800">¿Qué días se trabaja?</legend><div className="mt-2 flex flex-wrap gap-2">{ISO_WEEKDAYS.map(({ isoWeekday, label }) => <label key={isoWeekday} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${days[isoWeekday].enabled ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-500"}`}><input type="checkbox" checked={days[isoWeekday].enabled} onChange={() => toggleDay(isoWeekday)} className="size-4 rounded border-slate-300 text-blue-700" />{label}</label>)}</div></fieldset>
    <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 sm:p-5"><h3 className="text-xs font-bold text-slate-900">Horario habitual</h3><p className="mt-1 text-[11px] text-slate-500">Se aplicará a todos los días seleccionados. Puedes ajustar un día por separado abajo.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Entrada<TimePicker id="common-start" label="Hora habitual de entrada" required value={commonStart} onChange={(value) => updateCommonTime("start", value)} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Salida<TimePicker id="common-end" label="Hora habitual de salida" required value={commonEnd} onChange={(value) => updateCommonTime("end", value)} className={inputClass} /></label></div><p className="mt-2 text-[11px] text-slate-500">Si la salida es anterior a la entrada, el turno termina al día siguiente.</p></section>
    <div className="space-y-2">{enabled.map((day) => <details key={day.weekday} className="rounded-xl border border-slate-200 bg-white"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"><span className="text-xs font-semibold text-slate-800">{weekdayNames[day.weekday - 1]}</span><span className="text-xs text-slate-500">{day.start}–{day.end}{day.breaks.length ? ` · ${day.breaks.length} descanso(s)` : ""}</span></summary><div className="border-t border-slate-100 p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-semibold text-slate-600">Entrada del día<TimePicker id={`day-${day.weekday}-start`} label={`Entrada ${weekdayNames[day.weekday - 1]}`} required value={day.start} onChange={(value) => updateDay(day.weekday, { start: value })} className={inputClass} /></label><label className="text-[11px] font-semibold text-slate-600">Salida del día<TimePicker id={`day-${day.weekday}-end`} label={`Salida ${weekdayNames[day.weekday - 1]}`} required value={day.end} onChange={(value) => updateDay(day.weekday, { end: value })} className={inputClass} /></label></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-slate-500">{durationDisplay(day.start, day.end)} de permanencia</p><button type="button" onClick={() => updateDay(day.weekday, { breaks: [...day.breaks, { id: crypto.randomUUID(), name: "Comida", start: "13:00", end: "14:00", countsAsWork: true, requiresQr: true, required: false, maxMinutes: "" }] })} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-blue-100 px-3 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"><Coffee size={13} />Agregar descanso</button></div>{day.breaks.map((item, index) => <div key={item.id} className="mt-3 rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between"><p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700"><Coffee size={13} />Descanso {index + 1}</p><button type="button" aria-label={`Quitar descanso ${index + 1} de ${weekdayNames[day.weekday - 1]}`} onClick={() => updateDay(day.weekday, { breaks: day.breaks.filter((current) => current.id !== item.id) })} className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-rose-600"><X size={14} /></button></div><div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="text-[11px] font-semibold text-slate-600">Nombre<input value={item.name} onChange={(event) => updateBreak(day.weekday, item.id, { name: event.target.value })} className={inputClass} maxLength={80} /></label><label className="text-[11px] font-semibold text-slate-600">Inicio<TimePicker id={`break-${item.id}-start`} label={`Inicio descanso ${index + 1}`} required value={item.start} onChange={(value) => updateBreak(day.weekday, item.id, { start: value })} className={inputClass} /></label><label className="text-[11px] font-semibold text-slate-600">Regreso<TimePicker id={`break-${item.id}-end`} label={`Regreso descanso ${index + 1}`} required value={item.end} onChange={(value) => updateBreak(day.weekday, item.id, { end: value })} className={inputClass} /></label></div><details className="mt-2"><summary className="cursor-pointer text-[10px] font-medium text-slate-500">Opciones del descanso</summary><div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-slate-600"><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={item.countsAsWork} onChange={(event) => updateBreak(day.weekday, item.id, { countsAsWork: event.target.checked })} className="size-3.5 rounded border-slate-300 text-blue-700" />Cuenta como trabajo</label><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={item.requiresQr} onChange={(event) => updateBreak(day.weekday, item.id, { requiresQr: event.target.checked })} className="size-3.5 rounded border-slate-300 text-blue-700" />Requiere registro QR</label><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={item.required} onChange={(event) => updateBreak(day.weekday, item.id, { required: event.target.checked })} className="size-3.5 rounded border-slate-300 text-blue-700" />Requerido</label><label className="inline-flex items-center gap-2">Duración máxima (min)<input type="number" min={1} max={1440} value={item.maxMinutes} onChange={(event) => updateBreak(day.weekday, item.id, { maxMinutes: event.target.value })} className="h-8 w-20 rounded-lg border border-slate-200 px-2" /></label><span className="text-slate-400">Duración: {durationDisplay(item.start, item.end)}</span></div></details></div>)}</div></details>)}</div>
    <details className="rounded-xl border border-slate-200 px-4"><summary className="cursor-pointer py-3 text-xs font-semibold text-slate-700">Más opciones</summary><div className="grid gap-3 border-t border-slate-100 py-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Tipo de jornada<select name="workdayType" defaultValue={initial?.workday_type ?? "day"} className={inputClass}><option value="day">Diurna</option><option value="night">Nocturna</option><option value="mixed">Mixta</option></select></label><label className="text-xs font-semibold text-slate-700">Modalidad<select name="kind" defaultValue={initial?.kind ?? "fixed"} className={inputClass}><option value="fixed">Fija</option><option value="variable">Variable</option></select></label><label className="text-xs font-semibold text-slate-700">Tolerancia de entrada (min)<input required type="number" min={0} max={1440} name="entryToleranceMinutes" defaultValue={initial?.entry_tolerance_minutes ?? 0} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Vigente desde<input required type="date" name="effectiveFrom" defaultValue={initial?.effective_from ?? currentDate()} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Vigente hasta (opcional)<input type="date" name="effectiveTo" defaultValue={initial?.effective_to ?? ""} className={inputClass} /></label></div></details>
    <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" disabled={saving} onClick={requestClose} className={buttonSecondary}>Cancelar</button><button disabled={saving} className={buttonPrimary}>{saving ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}{saving ? "Guardando…" : initial ? "Guardar nueva versión" : "Crear horario"}</button></div>
    </form></section></div>;
}

function durationDisplay(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let minutes = endHour * 60 + endMinute - startHour * 60 - startMinute;
  if (minutes <= 0) minutes += 1440;
  return hours(minutes);
}

function AssignmentHistory({ schedules, query }: { schedules: Schedule[]; query: URLSearchParams }) {
  const [items, setItems] = useState<Array<{ id: string; employee_id: string; template_id: string | null; branch_id: string; starts_on: string; ends_on: string | null; planned_start_local: string | null; planned_end_local: string | null; planned_minutes: number }>>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    const timer = window.setTimeout(() => {
      void Promise.all([fetch(`/api/schedules/assignments?${params}`, { cache: "no-store", signal: controller.signal }), fetch(`/api/schedules?${params}`, { cache: "no-store", signal: controller.signal })])
        .then(async ([assignmentResponse, dataResponse]) => {
          const assignmentPayload = await assignmentResponse.json(); const dataPayload = await dataResponse.json();
          if (!assignmentResponse.ok) throw new Error(assignmentPayload.error?.message ?? "No fue posible cargar las asignaciones.");
          setItems(assignmentPayload.items ?? []); setEmployees(dataPayload.employees ?? []); setError("");
        }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No fue posible cargar el historial."); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  const employeeById = new Map(employees.map((item) => [item.id, item]));
  const scheduleById = new Map(schedules.map((item) => [item.id, item]));
  return <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><h2 className="text-sm font-bold text-slate-900">Historial de asignaciones</h2><p className="mt-1 text-xs text-slate-500">Periodos pasados y vigentes ordenados por fecha.</p></div>{error ? <p role="alert" className="p-5 text-xs text-rose-700">{error}</p> : !items.length ? <EmptyState icon={<Users size={20} />} title="Sin asignaciones" description="Las asignaciones creadas aparecerán aquí." /> : <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3">Empleado</th><th className="px-5 py-3">Horario</th><th className="px-5 py-3">Horario diario</th><th className="px-5 py-3">Vigencia</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id}><td className="px-5 py-3 text-xs font-semibold text-slate-800">{employeeById.get(item.employee_id) ? `${employeeById.get(item.employee_id)?.first_name} ${employeeById.get(item.employee_id)?.last_name}` : "Empleado"}</td><td className="px-5 py-3 text-xs text-slate-600">{scheduleById.get(item.template_id ?? "")?.name ?? "Horario variable"}</td><td className="px-5 py-3 text-xs text-slate-600">{hm(item.planned_start_local)}–{hm(item.planned_end_local)} · {hours(item.planned_minutes)}</td><td className="px-5 py-3 text-xs text-slate-600">{item.starts_on} – {item.ends_on ?? "abierta"}</td></tr>)}</tbody></table></div>}</section>;
}
