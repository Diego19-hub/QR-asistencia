"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowLeft, ArrowRight, ChevronDown, CircleAlert, Eye, Plus,
  Search, UserPlus, Users, X,
} from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";
import { formatInTimeZone } from "@/lib/datetime";

type Branch = { id: string; name: string; timezone: string };
type Employee = {
  id: string; employee_number: string; first_name: string; last_name: string; email: string | null; auth_user_id: string | null;
  branch_id: string | null; active: boolean; hired_on: string | null; terminated_on: string | null;
  created_at: string; updated_at: string; branch: Branch | null;
  currentSchedule: { name: string; startLocal: string | null; endLocal: string | null } | null;
};
type Listing = { items: Employee[]; branches: Branch[]; pagination: { page: number; pageSize: number; total: number; pages: number } };
type EmployeeField = "employee_number" | "first_name" | "last_name" | "email" | "hired_on" | "branch_id";
type FieldErrors = Partial<Record<EmployeeField, string>>;

const fieldClass = "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100";
const fieldNames: EmployeeField[] = ["employee_number", "first_name", "last_name", "email", "hired_on", "branch_id"];

function firstFieldErrors(value: unknown): FieldErrors {
  if (!value || typeof value !== "object") return {};
  const errors: FieldErrors = {};
  const entries = value as Record<string, unknown>;
  for (const name of fieldNames) {
    const messages = entries[name];
    if (Array.isArray(messages) && typeof messages[0] === "string") errors[name] = messages[0];
  }
  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span id={id} role="alert" className="mt-1 block text-xs font-medium text-rose-700">{message}</span> : null;
}

function displayDate(value: string, timezone: string) {
  return formatInTimeZone(value, timezone);
}

export function EmployeeManagement() {
  const { company } = useAdminContext();
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchParams = useSearchParams();
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingCompanyId, setListingCompanyId] = useState("");
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [branchId, setBranchId] = useState(() => searchParams.get("branchId") ?? "");
  const [active, setActive] = useState(() => new Set(["all", "true", "false"]).has(searchParams.get("active") ?? "all") ? searchParams.get("active") ?? "all" : "all");
  const [page, setPage] = useState(() => Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1));
  const [loadedKey, setLoadedKey] = useState("");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState("");
  const [busyEmployeeId, setBusyEmployeeId] = useState("");
  const requestKey = `${company.companyId}:${page}:${active}:${branchId}:${search.trim()}`;
  const latestRequestKey = useRef(requestKey);
  const loading = loadedKey !== requestKey;
  const failed = !loading && Boolean(error);
  const currentListing = !loading && !error && listingCompanyId === company.companyId ? listing : null;
  const branches = listingCompanyId === company.companyId ? listing?.branches ?? [] : [];
  const filtersActive = Boolean(search.trim() || branchId || active !== "all");

  useEffect(() => { latestRequestKey.current = requestKey; }, [requestKey]);

  const loadEmployees = useCallback(async (signal?: AbortSignal) => {
    const query = new URLSearchParams({ companyId: company.companyId, page: String(page), pageSize: "20", active });
    if (search.trim()) query.set("search", search.trim());
    if (branchId) query.set("branchId", branchId);
    try {
      const response = await fetch(`/api/employees?${query}`, { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "No fue posible cargar los empleados.");
      if (!signal?.aborted && latestRequestKey.current === requestKey) {
        setListing(body as Listing);
        setListingCompanyId(company.companyId);
        setError("");
      }
    } catch (reason) {
      if (!signal?.aborted && latestRequestKey.current === requestKey) setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
    } finally {
      if (!signal?.aborted && latestRequestKey.current === requestKey) setLoadedKey(requestKey);
    }
  }, [active, branchId, company.companyId, page, requestKey, search]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadEmployees(controller.signal), 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadEmployees, retry]);

  function closeCreate() {
    if (saving) return;
    if (formDirty && !window.confirm("Hay cambios sin guardar. ¿Cerrar y descartarlos?")) return;
    setCreateOpen(false);
    setFormDirty(false);
    setFormError("");
    setFieldErrors({});
    window.requestAnimationFrame(() => createButtonRef.current?.focus());
  }

  function openCreate(trigger?: HTMLButtonElement) {
    createButtonRef.current = trigger ?? createButtonRef.current;
    setFormError("");
    setFieldErrors({});
    setFormDirty(false);
    setNotice("");
    setCreateOpen(true);
  }

  function trapDialogFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCreate();
      return;
    }
    if (event.key !== "Tab") return;
    const items = event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]");
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError("");
    setFieldErrors({});
    const values = new FormData(event.currentTarget);
    const body = {
      employee_number: String(values.get("employee_number") ?? "").trim(),
      first_name: String(values.get("first_name") ?? "").trim(),
      last_name: String(values.get("last_name") ?? "").trim(),
      email: String(values.get("email") ?? "").trim() || null,
      branch_id: String(values.get("branch_id") ?? "") || null,
      hired_on: String(values.get("hired_on") ?? "") || null,
    };
    try {
      const response = await fetch(`/api/employees?companyId=${encodeURIComponent(company.companyId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        const fields = firstFieldErrors(payload.error?.fields);
        setFieldErrors(fields);
        throw new Error(Object.keys(fields).length ? "Revisa los campos indicados." : payload.error?.message ?? "No fue posible guardar el empleado.");
      }
      setCreateOpen(false);
      setFormDirty(false);
      window.requestAnimationFrame(() => createButtonRef.current?.focus());
      setFormError("");
      setNotice("El empleado se registró correctamente.");
      setSearch("");
      setBranchId("");
      setActive("all");
      setPage(1);
      setLoadedKey("");
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(employee: Employee) {
    if (busyEmployeeId) return;
    const nextActive = !employee.active;
    if (!nextActive && !window.confirm(`¿Desactivar a ${employee.first_name} ${employee.last_name}? Su historial laboral se conservará.`)) return;
    setBusyEmployeeId(employee.id);
    setNotice("");
    try {
      const response = await fetch(`/api/employees/${employee.id}?companyId=${encodeURIComponent(company.companyId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: nextActive }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "No fue posible cambiar el estado.");
      setNotice(nextActive ? "Empleado reactivado." : "Empleado desactivado. Su historial se conservó.");
      await loadEmployees();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
    } finally {
      setBusyEmployeeId("");
    }
  }

  function clearFilters() {
    setSearch("");
    setBranchId("");
    setActive("all");
    setPage(1);
  }

  const returnParams = new URLSearchParams({ search, branchId, active, page: String(page) });
  const directoryHref = `/admin/empleados?${returnParams.toString()}`;

  return <div className="space-y-6">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Personas y expedientes</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Empleados</h1><p className="mt-1 text-sm text-slate-500">Administra expedientes, horarios y credenciales de {company.companyName}.</p>{currentListing ? <p className="mt-2 text-xs font-medium text-slate-500">{currentListing.pagination.total} empleado{currentListing.pagination.total === 1 ? "" : "s"}{filtersActive ? " con los filtros actuales" : " registrados"}</p> : null}</div>
      <button ref={createButtonRef} type="button" onClick={(event) => openCreate(event.currentTarget)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"><Plus size={16} />Nuevo empleado</button>
    </section>

    {notice ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</div> : null}

    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(24,39,75,.035)]">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:px-5">
        <label className="relative min-w-0 flex-1 sm:max-w-sm"><span className="sr-only">Buscar por nombre o identificador</span><Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100" placeholder="Nombre o identificador" /></label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs text-slate-500 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 sm:flex-none"><span className="hidden sm:inline">Sucursal</span><select aria-label="Filtrar por sucursal" value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); }} className="min-w-0 max-w-44 cursor-pointer bg-transparent font-semibold text-slate-700 outline-none"><option value="">Todas las sucursales</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><ChevronDown aria-hidden="true" size={13} className="shrink-0 text-slate-400" /></label>
          <label className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs text-slate-500 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 sm:flex-none"><span className="hidden sm:inline">Estado</span><select aria-label="Filtrar por estado" value={active} onChange={(event) => { setActive(event.target.value); setPage(1); }} className="min-w-0 cursor-pointer bg-transparent font-semibold text-slate-700 outline-none"><option value="all">Todos</option><option value="true">Activos</option><option value="false">Inactivos</option></select><ChevronDown aria-hidden="true" size={13} className="shrink-0 text-slate-400" /></label>
          {filtersActive ? <button type="button" onClick={clearFilters} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Limpiar filtros<X size={13} /></button> : null}
        </div>
      </div>

      {loading ? <div aria-label="Cargando empleados" className="space-y-3 p-5">{[1, 2, 3, 4].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-50" />)}</div>
        : failed ? <div role="alert" className="px-6 py-14 text-center"><CircleAlert className="mx-auto text-rose-500" size={24} /><p className="mt-3 text-sm font-semibold text-slate-800">No se pudo cargar el directorio</p><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">{error}</p><button type="button" onClick={() => { setLoadedKey(""); setRetry((value) => value + 1); }} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Reintentar</button></div>
          : currentListing?.items.length ? <>
            <div className="divide-y divide-slate-100 lg:hidden">{currentListing.items.map((employee) => <article key={employee.id} className="space-y-3 p-4"><div className="flex items-start gap-3"><span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-800">{employee.first_name.slice(0, 1)}{employee.last_name.slice(0, 1)}</span><div className="min-w-0 flex-1"><Link href={`/admin/empleados/${employee.id}?companyId=${encodeURIComponent(company.companyId)}&returnTo=${encodeURIComponent(directoryHref)}`} className="break-words text-sm font-semibold text-slate-900 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{employee.first_name} {employee.last_name}</Link><p className="mt-0.5 text-xs text-slate-500">ID {employee.employee_number}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${employee.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{employee.active ? "Activo" : "Inactivo"}</span></div><dl className="grid grid-cols-2 gap-x-3 gap-y-2 pl-14 text-xs"><div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Sucursal</dt><dd className="mt-0.5 text-slate-700">{employee.branch?.name ?? "Sin sucursal"}</dd></div><div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Horario</dt><dd className="mt-0.5 text-slate-700">{employee.currentSchedule ? <>{employee.currentSchedule.name}<span className="mt-0.5 block text-[11px] text-slate-500">{employee.currentSchedule.startLocal?.slice(0, 5) ?? "Variable"}{employee.currentSchedule.endLocal ? ` – ${employee.currentSchedule.endLocal.slice(0, 5)}` : ""}</span></> : "Sin asignar"}</dd></div><div><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Registro</dt><dd className="mt-0.5 text-slate-700">{displayDate(employee.created_at, employee.branch?.timezone ?? "America/Mexico_City")}</dd></div></dl><div className="flex gap-2 pl-14"><Link href={`/admin/empleados/${employee.id}?companyId=${encodeURIComponent(company.companyId)}&returnTo=${encodeURIComponent(directoryHref)}`} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Eye size={14} />Ver expediente</Link><button type="button" disabled={Boolean(busyEmployeeId)} onClick={() => void toggleActive(employee)} className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-3 text-xs font-semibold disabled:opacity-50 ${employee.active ? "border-slate-200 text-slate-600 hover:border-rose-200 hover:text-rose-700" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>{busyEmployeeId === employee.id ? "Guardando…" : employee.active ? "Desactivar" : "Reactivar"}</button></div></article>)}</div>
            <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[850px] text-left"><thead><tr className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-[.1em] text-slate-400"><th scope="col" className="px-5 py-3.5">Empleado</th><th scope="col" className="px-4 py-3.5">Sucursal</th><th scope="col" className="px-4 py-3.5">Horario asignado</th><th scope="col" className="px-4 py-3.5">Estado</th><th scope="col" className="px-4 py-3.5">Registro</th><th scope="col" className="px-5 py-3.5 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100">{currentListing.items.map((employee) => <tr key={employee.id} className="text-xs transition-colors hover:bg-slate-50/60"><td className="px-5 py-4"><div className="flex items-center gap-3"><span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-800">{employee.first_name.slice(0, 1)}{employee.last_name.slice(0, 1)}</span><div><Link href={`/admin/empleados/${employee.id}?companyId=${encodeURIComponent(company.companyId)}&returnTo=${encodeURIComponent(directoryHref)}`} className="font-semibold text-slate-900 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{employee.first_name} {employee.last_name}</Link><p className="mt-1 text-[11px] text-slate-500">ID {employee.employee_number}</p></div></div></td><td className="px-4 py-4 text-slate-700">{employee.branch?.name ?? <span className="text-slate-400">Sin sucursal</span>}</td><td className="px-4 py-4">{employee.currentSchedule ? <><span className="block font-medium text-slate-700">{employee.currentSchedule.name}</span><span className="mt-1 block text-[11px] text-slate-500">{employee.currentSchedule.startLocal?.slice(0, 5) ?? "Variable"}{employee.currentSchedule.endLocal ? ` – ${employee.currentSchedule.endLocal.slice(0, 5)}` : ""}</span></> : <span className="text-slate-500">Sin asignar</span>}</td><td className="px-4 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${employee.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}><span aria-hidden="true" className={`size-1.5 rounded-full ${employee.active ? "bg-emerald-500" : "bg-slate-400"}`} />{employee.active ? "Activo" : "Inactivo"}</span></td><td className="whitespace-nowrap px-4 py-4 text-slate-600">{displayDate(employee.created_at, employee.branch?.timezone ?? "America/Mexico_City")}</td><td className="px-5 py-4"><div className="flex items-center justify-end gap-2"><Link href={`/admin/empleados/${employee.id}?companyId=${encodeURIComponent(company.companyId)}&returnTo=${encodeURIComponent(directoryHref)}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-blue-200 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Eye size={14} />Ver expediente</Link><button type="button" disabled={Boolean(busyEmployeeId)} onClick={() => void toggleActive(employee)} className={`min-h-10 rounded-lg border px-2.5 text-xs font-semibold disabled:opacity-50 ${employee.active ? "border-slate-200 text-slate-600 hover:border-rose-200 hover:text-rose-700" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>{busyEmployeeId === employee.id ? "Guardando…" : employee.active ? "Desactivar" : "Reactivar"}</button></div></td></tr>)}</tbody></table></div>
            <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3.5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-5"><span className="hidden sm:block">{currentListing.pagination.total} empleado{currentListing.pagination.total === 1 ? "" : "s"}</span><div className="flex items-center justify-between gap-2 sm:justify-end"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 hover:bg-slate-50 disabled:opacity-40"><ArrowLeft size={13} />Anterior</button><span aria-live="polite">Página {currentListing.pagination.page} de {Math.max(1, currentListing.pagination.pages)}</span><button type="button" disabled={page >= currentListing.pagination.pages || loading} onClick={() => setPage((value) => value + 1)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 hover:bg-slate-50 disabled:opacity-40">Siguiente<ArrowRight size={13} /></button></div></div>
          </>
          : <div className="px-5 py-14 text-center sm:px-6 sm:py-16"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-slate-50 text-slate-400"><Users size={23} /></div><p className="mt-4 text-sm font-semibold text-slate-900">{filtersActive ? "No encontramos empleados con esos filtros" : "Tu directorio está listo para empezar"}</p><p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-600">{filtersActive ? "Prueba cambiar la búsqueda, la sucursal o el estado." : "Registra el primer expediente. No necesitas crear una cuenta de acceso para cada empleado."}</p>{filtersActive ? <button type="button" onClick={clearFilters} className="mt-4 inline-flex min-h-10 items-center rounded-lg px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50">Limpiar filtros</button> : <button type="button" onClick={(event) => openCreate(event.currentTarget)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><UserPlus size={15} />Registrar primer empleado</button>}</div>}
    </section>

    {createOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreate(); }}><section role="dialog" aria-modal="true" aria-labelledby="create-employee-title" onKeyDown={trapDialogFocus} className="my-auto w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Nuevo expediente</p><h2 id="create-employee-title" className="mt-1 text-xl font-bold text-slate-950">Registrar empleado</h2><p className="mt-1 text-sm text-slate-600">Los campos con * son obligatorios. Se guardará en {company.companyName}.</p></div><button type="button" onClick={closeCreate} aria-label="Cerrar" className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><X size={18} /></button></div>
      <form onSubmit={createEmployee} onChangeCapture={() => setFormDirty(true)} className="mt-6 space-y-5">
        <fieldset className="space-y-3"><legend className="text-xs font-bold uppercase tracking-wide text-slate-700">Datos personales</legend><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Nombre(s) *<input autoFocus required name="first_name" maxLength={100} aria-invalid={Boolean(fieldErrors.first_name)} aria-describedby={fieldErrors.first_name ? "create-first-name-error" : undefined} className={fieldClass} autoComplete="given-name" /><FieldError id="create-first-name-error" message={fieldErrors.first_name} /></label><label className="text-xs font-semibold text-slate-700">Apellidos *<input required name="last_name" maxLength={120} aria-invalid={Boolean(fieldErrors.last_name)} aria-describedby={fieldErrors.last_name ? "create-last-name-error" : undefined} className={fieldClass} autoComplete="family-name" /><FieldError id="create-last-name-error" message={fieldErrors.last_name} /></label><label className="text-xs font-semibold text-slate-700 sm:col-span-2">Correo electrónico <span className="font-normal text-slate-500">(opcional)</span><input name="email" type="email" maxLength={254} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "create-email-error" : undefined} className={fieldClass} placeholder="nombre@empresa.mx" autoComplete="email" /><FieldError id="create-email-error" message={fieldErrors.email} /></label></div></fieldset>
        <fieldset className="space-y-3"><legend className="text-xs font-bold uppercase tracking-wide text-slate-700">Información laboral</legend><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Identificador interno *<input required name="employee_number" maxLength={64} aria-invalid={Boolean(fieldErrors.employee_number)} aria-describedby={fieldErrors.employee_number ? "create-number-error" : undefined} className={fieldClass} placeholder="EMP-001" /><FieldError id="create-number-error" message={fieldErrors.employee_number} /></label><label className="text-xs font-semibold text-slate-700">Fecha de ingreso<input name="hired_on" type="date" aria-invalid={Boolean(fieldErrors.hired_on)} aria-describedby={fieldErrors.hired_on ? "create-hire-error" : undefined} className={fieldClass} /><FieldError id="create-hire-error" message={fieldErrors.hired_on} /></label><label className="text-xs font-semibold text-slate-700 sm:col-span-2">Sucursal <span className="font-normal text-slate-500">(opcional)</span><select name="branch_id" aria-invalid={Boolean(fieldErrors.branch_id)} aria-describedby={fieldErrors.branch_id ? "create-branch-error" : undefined} className={fieldClass}><option value="">Sin sucursal</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><FieldError id="create-branch-error" message={fieldErrors.branch_id} /></label></div></fieldset>
        {formError ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><CircleAlert size={16} className="mt-0.5 shrink-0" />{formError}</div> : null}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><button type="button" disabled={saving} onClick={closeCreate} className="min-h-11 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button><button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-[#14264a] px-5 text-xs font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-50">{saving ? "Guardando…" : "Guardar empleado"}</button></div>
      </form></section></div> : null}
  </div>;
}
