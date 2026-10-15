"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, CircleAlert, Eye, Plus, Search, UserPlus, Users, X } from "lucide-react";

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

const fieldClass = "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100";

export function EmployeeManagement() {
  const { company } = useAdminContext();
  const [listing, setListing] = useState<Listing | null>(null);
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState("");
  const [active, setActive] = useState("all");
  const [page, setPage] = useState(1);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const requestKey = `${company.companyId}:${page}:${active}:${branchId}:${search}`;
  const loading = loadedKey !== requestKey;

  const loadEmployees = useCallback(async (signal?: AbortSignal) => {
    const query = new URLSearchParams({ companyId: company.companyId, page: String(page), pageSize: "20", active });
    if (search.trim()) query.set("search", search.trim());
    if (branchId) query.set("branchId", branchId);
    try {
      const response = await fetch(`/api/employees?${query}`, { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "No fue posible cargar los empleados.");
      setListing(body as Listing);
      setError("");
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
    } finally {
      if (!signal?.aborted) setLoadedKey(requestKey);
    }
  }, [active, branchId, company.companyId, page, requestKey, search]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadEmployees(controller.signal), 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadEmployees]);

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
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
        const fields = payload.error?.fields as Record<string, string[]> | undefined;
        throw new Error(fields ? Object.values(fields).flat().join(" ") : payload.error?.message ?? "No fue posible guardar el empleado.");
      }
      setCreateOpen(false);
      setNotice("El empleado se registró correctamente.");
      setPage(1);
      await loadEmployees();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(employee: Employee) {
    const nextActive = !employee.active;
    if (!nextActive && !window.confirm(`¿Desactivar a ${employee.first_name} ${employee.last_name}? Su historial laboral se conservará.`)) return;
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
    }
  }

  return <div className="space-y-6">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Personas y expedientes</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Empleados</h1><p className="mt-1 text-sm text-slate-500">Administra los expedientes laborales de {company.companyName}.</p></div>
      <button onClick={() => { setFormError(""); setCreateOpen(true); }} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-900"><Plus size={16} />Nuevo empleado</button>
    </section>

    {notice ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</div> : null}
    {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert className="mt-0.5 shrink-0" size={17} />{error}</div> : null}

    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(24,39,75,.035)]">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <label className="relative min-w-0 flex-1 sm:max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100" placeholder="Buscar nombre o identificador" /></label>
        <div className="flex flex-wrap gap-2">
          <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-[11px] text-slate-500"><span className="hidden sm:inline">Sucursal</span><select aria-label="Filtrar por sucursal" value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); }} className="max-w-40 bg-transparent text-xs font-semibold text-slate-700 outline-none"><option value="">Todas</option>{(listing?.branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><ChevronDown size={13} className="text-slate-400" /></label>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-[11px] text-slate-500"><span className="hidden sm:inline">Estado</span><select aria-label="Filtrar por estado" value={active} onChange={(event) => { setActive(event.target.value); setPage(1); }} className="bg-transparent text-xs font-semibold text-slate-700 outline-none"><option value="all">Todos</option><option value="true">Activos</option><option value="false">Inactivos</option></select><ChevronDown size={13} className="text-slate-400" /></label>
        </div>
      </div>

      {loading ? <div className="space-y-3 p-5">{[1, 2, 3, 4].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-slate-50" />)}</div> : listing?.items.length ? <><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left"><thead><tr className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-[.1em] text-slate-400"><th className="px-5 py-3.5">Empleado</th><th className="px-4 py-3.5">Sucursal</th><th className="px-4 py-3.5">Horario asignado</th><th className="px-4 py-3.5">Estado</th><th className="px-4 py-3.5">Registro</th><th className="px-5 py-3.5 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100">{listing.items.map((employee) => <tr key={employee.id} className="text-xs transition hover:bg-slate-50/60"><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-800">{employee.first_name.slice(0, 1)}{employee.last_name.slice(0, 1)}</span><div><Link href={`/admin/empleados/${employee.id}?companyId=${company.companyId}`} className="font-semibold text-slate-800 hover:text-blue-700">{employee.first_name} {employee.last_name}</Link><p className="mt-1 text-[11px] text-slate-400">ID {employee.employee_number}{employee.email ? ` · ${employee.email}` : ""}</p></div></div></td><td className="px-4 py-4 text-slate-600">{employee.branch?.name ?? <span className="text-slate-400">Sin sucursal</span>}</td><td className="px-4 py-4">{employee.currentSchedule ? <><span className="block font-medium text-slate-700">{employee.currentSchedule.name}</span><span className="mt-1 block text-[11px] text-slate-400">{employee.currentSchedule.startLocal?.slice(0, 5) ?? "Variable"}{employee.currentSchedule.endLocal ? ` – ${employee.currentSchedule.endLocal.slice(0, 5)}` : ""}</span></> : <span className="text-slate-400">Sin asignar</span>}</td><td className="px-4 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${employee.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}><span className={`size-1.5 rounded-full ${employee.active ? "bg-emerald-500" : "bg-slate-400"}`} />{employee.active ? "Activo" : "Inactivo"}</span></td><td className="px-4 py-4 text-slate-500">{formatInTimeZone(employee.created_at, employee.branch?.timezone ?? "America/Mexico_City")}</td><td className="px-5 py-4"><div className="flex items-center justify-end gap-2"><Link aria-label={`Ver ${employee.first_name} ${employee.last_name}`} href={`/admin/empleados/${employee.id}?companyId=${company.companyId}`} className="grid size-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:border-blue-200 hover:text-blue-700"><Eye size={15} /></Link><button onClick={() => void toggleActive(employee)} className={`rounded-lg border px-2.5 py-2 text-[10px] font-semibold ${employee.active ? "border-slate-200 text-slate-600 hover:border-rose-200 hover:text-rose-700" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>{employee.active ? "Desactivar" : "Reactivar"}</button></div></td></tr>)}</tbody></table></div>
        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-3.5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>{listing.pagination.total} empleado{listing.pagination.total === 1 ? "" : "s"}</span><div className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 disabled:opacity-40"><ArrowLeft size={13} />Anterior</button><span>Página {listing.pagination.page} de {Math.max(1, listing.pagination.pages)}</span><button disabled={page >= listing.pagination.pages} onClick={() => setPage((value) => value + 1)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 disabled:opacity-40">Siguiente<ArrowRight size={13} /></button></div></div></> : <div className="px-6 py-16 text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-slate-50 text-slate-400"><Users size={23} /></div><p className="mt-4 text-sm font-semibold text-slate-800">{search || active !== "all" || branchId ? "No encontramos empleados con esos filtros" : "Tu directorio está listo para empezar"}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">{search || active !== "all" || branchId ? "Prueba cambiar la búsqueda, la sucursal o el estado." : "Registra el primer expediente. El empleado no necesita una cuenta de acceso todavía."}</p>{!search && active === "all" && !branchId ? <button onClick={() => setCreateOpen(true)} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white"><UserPlus size={15} />Registrar primer empleado</button> : null}</div>}
    </section>

    {createOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="create-employee-title" className="my-auto w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl sm:p-7"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Nuevo expediente</p><h2 id="create-employee-title" className="mt-1 text-xl font-bold text-slate-950">Registrar empleado</h2><p className="mt-1 text-xs text-slate-500">Los campos se guardarán en {company.companyName}.</p></div><button onClick={() => setCreateOpen(false)} aria-label="Cerrar" className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button></div>
      <form onSubmit={createEmployee} className="mt-6 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Identificador interno<input required name="employee_number" maxLength={64} className={fieldClass} placeholder="EMP-001" /></label><label className="text-xs font-semibold text-slate-700">Fecha de ingreso<input name="hired_on" type="date" className={fieldClass} /></label><label className="text-xs font-semibold text-slate-700">Nombre(s)<input required name="first_name" maxLength={100} className={fieldClass} /></label><label className="text-xs font-semibold text-slate-700">Apellidos<input required name="last_name" maxLength={120} className={fieldClass} /></label><label className="text-xs font-semibold text-slate-700">Correo electrónico <span className="font-normal text-slate-400">(opcional)</span><input name="email" type="email" maxLength={254} className={fieldClass} placeholder="nombre@empresa.mx" /></label><label className="text-xs font-semibold text-slate-700">Sucursal <span className="font-normal text-slate-400">(opcional)</span><select name="branch_id" className={fieldClass}><option value="">Sin sucursal</option>{(listing?.branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label></div>
        {formError ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><CircleAlert size={16} className="mt-0.5 shrink-0" />{formError}</div> : null}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => setCreateOpen(false)} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600">Cancelar</button><button disabled={saving} className="h-10 rounded-xl bg-[#14264a] px-5 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar empleado"}</button></div>
      </form></section></div> : null}
  </div>;
}
