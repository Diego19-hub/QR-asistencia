"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, CircleAlert, Clock3, RefreshCw, Save, ShieldCheck, Store } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAdminContext } from "@/components/admin/admin-context";
import { UserAccessManagement } from "@/components/admin/user-access-management";

type Company = { id: string; name: string; legal_name: string | null; rfc: string | null; updated_at: string };
type Branch = { id: string; name: string; timezone: string; active: boolean };
type Permission = { code: string; description: string };
type AuditEntry = { id: number; actor_user_id: string | null; action: string; entity_table: string; entity_id: string | null; occurred_at: string; changedFields: string[] };
type ApiBody<T> = T & { error?: { message?: string } };

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(24,39,75,.035)]";
const input = "mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const timezones = ["America/Mexico_City", "America/Tijuana", "America/Cancun", "America/Chihuahua", "America/Hermosillo", "America/Monterrey", "America/Merida", "America/Mazatlan"];
const roleNames: Record<string, string> = { owner: "Propietario", admin: "Administrador", supervisor: "Supervisor", employee: "Empleado" };

export function CompanySettings({ publicOrigin }: { publicOrigin: string | null }) {
  const { company } = useAdminContext();
  const router = useRouter();
  const [companyData, setCompanyData] = useState<Company | null>(null);
  const [companyForm, setCompanyForm] = useState({ name: "", legalName: "", rfc: "" });
  const [canManage, setCanManage] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Array<{ role: string; permission_code: string }>>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 });
  const [auditFilters, setAuditFilters] = useState({ from: "", to: "", action: "" });
  const [appliedAuditFilters, setAppliedAuditFilters] = useState({ from: "", to: "", action: "" });
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busyBranch, setBusyBranch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const query = `companyId=${encodeURIComponent(company.companyId)}`;
  const load = useCallback(async (auditPage = 1, signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const auditParams = new URLSearchParams({ companyId: company.companyId, page: String(auditPage), pageSize: "20", ...appliedAuditFilters });
      const [companyResponse, branchResponse, permissionResponse, auditResponse] = await Promise.all([
        fetch(`/api/company?${query}`, { cache: "no-store", signal }),
        fetch(`/api/branches?${query}`, { cache: "no-store", signal }),
        fetch(`/api/admin/permissions?${query}`, { cache: "no-store", signal }),
        fetch(`/api/admin/audit?${auditParams}`, { cache: "no-store", signal }),
      ]);
      const [companyBody, branchBody, permissionBody, auditBody] = await Promise.all([
        companyResponse.json() as Promise<ApiBody<{ item?: Company; canManage?: boolean }>>,
        branchResponse.json() as Promise<ApiBody<{ items?: Branch[] }>>,
        permissionResponse.json() as Promise<ApiBody<{ permissions?: Permission[]; rolePermissions?: Array<{ role: string; permission_code: string }> }>>,
        auditResponse.json() as Promise<ApiBody<{ items?: AuditEntry[]; pagination?: { page: number; pages: number; total: number } }>>,
      ]);
      const failed = [companyResponse, branchResponse, permissionResponse, auditResponse].find((response) => !response.ok);
      if (failed) {
        const bodies = [companyBody, branchBody, permissionBody, auditBody];
        throw new Error(bodies[[companyResponse, branchResponse, permissionResponse, auditResponse].indexOf(failed)]?.error?.message ?? "No fue posible cargar la configuración.");
      }
      setCompanyData(companyBody.item ?? null); setCanManage(companyBody.canManage === true);
      setCompanyForm({ name: companyBody.item?.name ?? "", legalName: companyBody.item?.legal_name ?? "", rfc: companyBody.item?.rfc ?? "" });
      setBranches(branchBody.items ?? []); setPermissions(permissionBody.permissions ?? []); setRolePermissions(permissionBody.rolePermissions ?? []);
      setAudit(auditBody.items ?? []); setPagination(auditBody.pagination ?? { page: 1, pages: 0, total: 0 });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setCompanyData(null); setBranches([]); setPermissions([]); setRolePermissions([]); setAudit([]);
      setError(reason instanceof Error ? reason.message : "No fue posible cargar la configuración.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [company.companyId, query, appliedAuditFilters]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(1, controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  useEffect(() => {
    const syncSettingsHash = () => {
      if (window.location.hash === "#supervisores") {
        router.replace(`/admin/supervisores${window.location.search}`);
        return;
      }
      if (window.location.hash === "#avanzada") setAdvancedOpen(true);
    };
    syncSettingsHash();
    window.addEventListener("hashchange", syncSettingsHash);
    return () => window.removeEventListener("hashchange", syncSettingsHash);
  }, [router]);

  async function saveCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canManage || !companyData) return;
    setSaving(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/company?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), legalName: form.get("legalName") || null, rfc: form.get("rfc") || null }) });
      const body = await response.json() as ApiBody<{ item?: Company }>;
      if (!response.ok || !body.item) throw new Error(body.error?.message ?? "No fue posible guardar los datos de la empresa.");
      setCompanyData(body.item); setCompanyForm({ name: body.item.name, legalName: body.item.legal_name ?? "", rfc: body.item.rfc ?? "" }); setNotice("Los datos de la empresa se actualizaron y la operación quedó en auditoría."); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible guardar los datos."); }
    finally { setSaving(false); }
  }

  async function createBranch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canManage) return;
    setBusyBranch("new"); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;
    try {
      const response = await fetch(`/api/branches?${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), timezone: form.get("timezone") }) });
      const body = await response.json() as ApiBody<{ item?: Branch }>;
      if (!response.ok) throw new Error(body.error?.message ?? "No fue posible crear la sucursal.");
      formElement.reset(); setNotice("Sucursal creada."); await load(pagination.page);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible crear la sucursal."); }
    finally { setBusyBranch(""); }
  }

  async function toggleBranch(branch: Branch) {
    if (!canManage || !window.confirm(`${branch.active ? "¿Desactivar" : "¿Activar"} la sucursal “${branch.name}”?`)) return;
    setBusyBranch(branch.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/branches?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: branch.id, active: !branch.active }) });
      const body = await response.json() as ApiBody<{ item?: Branch }>;
      if (!response.ok) throw new Error(body.error?.message ?? "No fue posible actualizar la sucursal.");
      setNotice(`Sucursal ${branch.active ? "desactivada" : "activada"}.`); await load(pagination.page);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible actualizar la sucursal."); }
    finally { setBusyBranch(""); }
  }

  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Administración de la empresa</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Configuración</h1><p className="mt-1 text-sm text-slate-500">Empresa activa: {company.companyName}. Gestiona datos y sucursales con alcance limitado a esta empresa.</p></div><button type="button" onClick={() => void load(pagination.page)} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />Actualizar</button></header>
    <nav aria-label="Secciones de configuración" className="sticky top-0 z-10 -mx-1 flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
      {[["#empresa", "Empresa"], ["#sucursales", "Sucursales"], ["#avanzada", "Configuración avanzada"]].map(([href, title]) => <a key={href} href={href} className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{title}</a>)}
    </nav>
    {notice ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
    {error ? <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert size={17} className="shrink-0" />{error}</div> : null}
    <section id="empresa" className={`${card} scroll-mt-24 p-5 sm:p-6`}><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Building2 size={19} /></div><div><h2 className="font-semibold text-slate-900">Datos de la empresa</h2><p className="mt-0.5 text-xs text-slate-500">Los cambios se registran en la bitácora administrativa.</p></div></div>
      {companyData ? <form onSubmit={(event) => void saveCompany(event)} className="mt-5 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Nombre comercial<input name="name" required maxLength={180} value={companyForm.name} onChange={(event) => setCompanyForm({ ...companyForm, name: event.target.value })} disabled={!canManage || saving} className={input} /></label><label className="text-xs font-semibold text-slate-700">Razón social<input name="legalName" maxLength={240} value={companyForm.legalName} onChange={(event) => setCompanyForm({ ...companyForm, legalName: event.target.value })} disabled={!canManage || saving} className={input} /></label><label className="text-xs font-semibold text-slate-700 sm:col-span-2">RFC<input name="rfc" maxLength={13} value={companyForm.rfc} onChange={(event) => setCompanyForm({ ...companyForm, rfc: event.target.value.toUpperCase() })} disabled={!canManage || saving} className={`${input} uppercase`} placeholder="Opcional" /></label></div><div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">Última actualización: {new Date(companyData.updated_at).toLocaleString("es-MX")}</p>{canManage ? <button disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white disabled:opacity-50"><Save size={15} />{saving ? "Guardando…" : "Guardar cambios"}</button> : <span className="text-xs font-medium text-amber-700">Tu rol no tiene company.manage.</span>}</div></form> : <p className="mt-5 text-sm text-slate-500">{loading ? "Cargando…" : "No fue posible cargar los datos."}</p>}
    </section>
    <section id="sucursales" className={`${card} scroll-mt-24 p-5 sm:p-6`}><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Store size={19} /></div><div><h2 className="font-semibold text-slate-900">Sucursales</h2><p className="mt-0.5 text-xs text-slate-500">Consulta, crea y cambia el estado de sucursales. No se eliminan registros.</p></div></div>
      {canManage ? <form onSubmit={(event) => void createBranch(event)} className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-xs font-semibold text-slate-700">Nombre de sucursal<input name="name" required maxLength={120} className={input} placeholder="Ej. Centro" /></label><label className="text-xs font-semibold text-slate-700">Zona horaria<select name="timezone" className={input}>{timezones.map((zone) => <option key={zone}>{zone}</option>)}</select></label><button disabled={busyBranch === "new"} className="h-11 rounded-xl bg-blue-700 px-4 text-xs font-semibold text-white disabled:opacity-50">{busyBranch === "new" ? "Creando…" : "Crear sucursal"}</button></form> : null}
      <div className="mt-4 divide-y divide-slate-100">{branches.map((branch) => <div key={branch.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-slate-900">{branch.name}</p><p className="mt-1 text-xs text-slate-500">{branch.timezone}</p></div><div className="flex items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${branch.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{branch.active ? "Activa" : "Inactiva"}</span>{canManage ? <button type="button" disabled={Boolean(busyBranch)} onClick={() => void toggleBranch(branch)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-50">{busyBranch === branch.id ? "Guardando…" : branch.active ? "Desactivar" : "Activar"}</button> : null}</div></div>)}{!loading && !branches.length ? <p className="py-5 text-sm text-slate-500">No hay sucursales.</p> : null}</div>
    </section>
    <details id="avanzada" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)} className={`${card} group p-5 sm:p-6`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <span><span className="block">Configuración avanzada</span><span className="mt-1 block text-xs font-normal text-slate-500">Permisos, auditoría y opciones especializadas.</span></span>
        <span aria-hidden="true" className="text-slate-400 transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="mt-5 space-y-6">
    <section aria-labelledby="authorized-people-title" className="space-y-3"><div><h2 id="authorized-people-title" className="text-lg font-bold text-slate-900">Usuarios y accesos</h2><p className="mt-1 text-sm text-slate-500">Invitaciones, membresías y asignación de expedientes de {company.companyName}.</p></div><UserAccessManagement publicOrigin={publicOrigin} /></section>
    <section className={`${card} overflow-hidden`}><div className="flex items-center gap-3 border-b border-slate-100 p-5 sm:p-6"><div className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700"><ShieldCheck size={19} /></div><div><h2 className="font-semibold text-slate-900">Roles y permisos</h2><p className="mt-0.5 text-xs text-slate-500">Permisos base por rol en modo consulta; un override de membresía puede cambiar un permiso efectivo.</p></div></div><div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 font-semibold">Permiso</th>{["owner", "admin", "supervisor", "employee"].map((role) => <th key={role} className="px-3 py-3 text-center font-semibold">{roleNames[role]}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{permissions.map((permission) => <tr key={permission.code}><td className="px-5 py-3"><p className="font-semibold text-slate-800">{permission.description}</p><p className="mt-0.5 font-mono text-[10px] text-slate-400">{permission.code}</p></td>{["owner", "admin", "supervisor", "employee"].map((role) => <td key={role} className="px-3 py-3 text-center">{rolePermissions.some((item) => item.role === role && item.permission_code === permission.code) ? <span className="font-bold text-emerald-700" aria-label="Permitido">✓</span> : <span className="text-slate-300" aria-label="No permitido">—</span>}</td>)}</tr>)}</tbody></table></div></section>
    <section className={`${card} overflow-hidden`}><div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:p-6"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><Clock3 size={19} /></div><div><h2 className="font-semibold text-slate-900">Auditoría administrativa</h2><p className="mt-0.5 text-xs text-slate-500">Acciones de la empresa activa; no se incluyen valores sensibles anteriores y nuevos.</p></div></div><form onSubmit={(event) => { event.preventDefault(); setAppliedAuditFilters({ ...auditFilters }); setPagination({ page: 1, pages: pagination.pages, total: pagination.total }); }} className="grid gap-3 sm:grid-cols-4"><label className="text-[11px] font-semibold text-slate-600">Desde<input type="date" value={auditFilters.from} onChange={(event) => setAuditFilters({ ...auditFilters, from: event.target.value })} className={input} /></label><label className="text-[11px] font-semibold text-slate-600">Hasta<input type="date" value={auditFilters.to} onChange={(event) => setAuditFilters({ ...auditFilters, to: event.target.value })} className={input} /></label><label className="text-[11px] font-semibold text-slate-600">Acción<input value={auditFilters.action} onChange={(event) => setAuditFilters({ ...auditFilters, action: event.target.value })} maxLength={80} className={input} placeholder="Ej. UPDATE" /></label><button className="h-11 self-end rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700">Aplicar filtros</button></form></div>
      {audit.length ? <div className="divide-y divide-slate-100">{audit.map((entry) => <article key={entry.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-slate-800">{auditAction(entry.action)} <span className="font-normal text-slate-500">· {entry.entity_table}</span></p>{entry.changedFields.length ? <p className="mt-1 text-xs text-slate-600">Campos: {entry.changedFields.join(", ")}</p> : null}<p className="mt-1 text-[11px] text-slate-500">Registro {entry.entity_id ?? "—"} · Actor {entry.actor_user_id ?? "cuenta eliminada"}</p></div><time className="text-xs text-slate-500">{new Date(entry.occurred_at).toLocaleString("es-MX")}</time></article>)}</div> : <p className="p-5 text-sm text-slate-500">{loading ? "Cargando auditoría…" : "No hay acciones para estos filtros."}</p>}
      <div className="flex flex-col gap-3 border-t border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">{pagination.total} acciones · Página {pagination.page} de {Math.max(pagination.pages, 1)}</p><div className="flex gap-2"><button type="button" disabled={pagination.page <= 1 || loading} onClick={() => void load(pagination.page - 1)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs disabled:opacity-40">Anterior</button><button type="button" disabled={pagination.page >= pagination.pages || loading} onClick={() => void load(pagination.page + 1)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs disabled:opacity-40">Siguiente</button></div></div>
    </section>
      </div>
    </details>
  </div>;
}

function auditAction(value: string) { return value === "INSERT" ? "Creó" : value === "UPDATE" ? "Actualizó" : value === "DELETE" ? "Eliminó" : value.replaceAll("_", " ").toLowerCase(); }
