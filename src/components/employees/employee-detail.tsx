"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, BriefcaseBusiness, CalendarDays, CircleAlert, Mail, MapPin, Pencil, Save, UserRound, X } from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";
import { EmployeeCredentials } from "@/components/employees/employee-credentials";

type Branch = { id: string; name: string; timezone: string };
type Employee = {
  id: string; employee_number: string; first_name: string; last_name: string; email: string | null;
  branch_id: string | null; active: boolean; hired_on: string | null; terminated_on: string | null;
  created_at: string; updated_at: string; branch: Branch | null;
  currentSchedule: { id: string; name: string; kind: string; startsOn: string; endsOn: string | null; startLocal: string | null; endLocal: string | null; plannedMinutes: number } | null;
};
type EmployeePayload = { item: Employee };
type BranchPayload = { branches: Branch[] };

const inputClass = "mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100";

export function EmployeeDetail({ employeeId }: { employeeId: string }) {
  const { company } = useAdminContext();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestKey = `${company.companyId}:${employeeId}`;
  const loading = loadedKey !== requestKey;

  const loadEmployee = useCallback(async (signal?: AbortSignal) => {
    try {
      const query = new URLSearchParams({ companyId: company.companyId });
      const [employeeResponse, listResponse] = await Promise.all([
        fetch(`/api/employees/${employeeId}?${query}`, { cache: "no-store", signal }),
        fetch(`/api/employees?${query}&pageSize=1`, { cache: "no-store", signal }),
      ]);
      const [employeePayload, listPayload] = await Promise.all([employeeResponse.json(), listResponse.json()]);
      if (!employeeResponse.ok) throw new Error(employeePayload.error?.message ?? "No fue posible cargar el expediente.");
      if (!listResponse.ok) throw new Error(listPayload.error?.message ?? "No fue posible cargar las sucursales.");
      setEmployee((employeePayload as EmployeePayload).item);
      setBranches((listPayload as BranchPayload).branches);
      setError("");
    } catch (reason) {
      if (!signal?.aborted) {
        setEmployee(null);
        setBranches([]);
        setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
      }
    } finally { if (!signal?.aborted) setLoadedKey(requestKey); }
  }, [company.companyId, employeeId, requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadEmployee(controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadEmployee]);

  async function saveChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employee) return;
    setSaving(true);
    setError("");
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
      const query = new URLSearchParams({ companyId: company.companyId });
      const response = await fetch(`/api/employees/${employee.id}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) {
        const fields = payload.error?.fields as Record<string, string[]> | undefined;
        throw new Error(fields ? Object.values(fields).flat().join(" ") : payload.error?.message ?? "No fue posible guardar los cambios.");
      }
      setEmployee((payload as EmployeePayload).item);
      setEditing(false);
      setNotice("Los cambios se guardaron correctamente.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
    } finally { setSaving(false); }
  }

  async function setActive(active: boolean) {
    if (!employee) return;
    if (!active && !window.confirm(`¿Desactivar a ${employee.first_name} ${employee.last_name}? Se conservará su historial laboral.`)) return;
    setError("");
    const query = new URLSearchParams({ companyId: company.companyId });
    try {
      const response = await fetch(`/api/employees/${employee.id}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "No fue posible cambiar el estado.");
      setEmployee((payload as EmployeePayload).item);
      setNotice(active ? "Empleado reactivado." : "Empleado desactivado. El historial se conservó.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado."); }
  }

  if (loading) return <div className="mx-auto max-w-4xl animate-pulse space-y-4"><div className="h-5 w-40 rounded bg-slate-200" /><div className="h-44 rounded-2xl bg-white" /><div className="h-72 rounded-2xl bg-white" /></div>;
  if (!employee) return <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 text-center"><CircleAlert className="mx-auto text-rose-500" /><h1 className="mt-3 text-lg font-bold text-slate-900">No encontramos el expediente</h1><p className="mt-1 text-sm text-slate-500">{error || "Verifica el identificador o tu acceso a esta empresa."}</p><Link href="/admin/empleados" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft size={16} />Volver a empleados</Link></div>;

  return <div className="mx-auto max-w-5xl space-y-6">
    <Link href="/admin/empleados" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-blue-700"><ArrowLeft size={15} />Volver al directorio</Link>
    <section className="flex flex-col justify-between gap-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:p-7">
      <div className="flex items-center gap-4"><span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-blue-50 text-xl font-bold text-blue-800">{employee.first_name.slice(0, 1)}{employee.last_name.slice(0, 1)}</span><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Expediente de {company.companyName}</p><h1 className="mt-1 text-xl font-bold text-slate-950 sm:text-2xl">{employee.first_name} {employee.last_name}</h1><p className="mt-1 text-xs text-slate-500">Identificador {employee.employee_number}</p></div></div>
      <div className="flex flex-wrap items-center gap-2"><span className={`mr-auto rounded-full px-3 py-1.5 text-[11px] font-semibold ${employee.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{employee.active ? "Activo" : "Inactivo"}</span>{!editing ? <><Link href={`/admin/reportes?employeeId=${employee.id}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 px-4 text-xs font-semibold text-blue-800 hover:bg-blue-50"><CalendarDays size={14} />Ver reporte</Link><button onClick={() => { setNotice(""); setEditing(true); }} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Pencil size={14} />Editar</button><button onClick={() => void setActive(!employee.active)} className={`h-10 rounded-xl px-4 text-xs font-semibold ${employee.active ? "border border-rose-200 text-rose-700 hover:bg-rose-50" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>{employee.active ? "Desactivar" : "Reactivar"}</button></> : null}</div>
    </section>

    {notice ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
    {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert size={16} className="mt-0.5 shrink-0" />{error}</div> : null}

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><UserRound size={17} /></span><div><h2 className="text-sm font-bold text-slate-900">Información personal y laboral</h2><p className="mt-1 text-xs text-slate-400">Expediente vinculado al área de trabajo</p></div></div>
        {editing ? <form onSubmit={saveChanges} className="mt-6 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Identificador interno<input required name="employee_number" defaultValue={employee.employee_number} maxLength={64} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Fecha de ingreso<input name="hired_on" type="date" defaultValue={employee.hired_on ?? ""} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Nombre(s)<input required name="first_name" defaultValue={employee.first_name} maxLength={100} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Apellidos<input required name="last_name" defaultValue={employee.last_name} maxLength={120} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Correo electrónico<input name="email" type="email" defaultValue={employee.email ?? ""} maxLength={254} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Sucursal<select name="branch_id" defaultValue={employee.branch_id ?? ""} className={inputClass}><option value="">Sin sucursal</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label></div><div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => setEditing(false)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600"><X size={14} />Cancelar</button><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white disabled:opacity-50"><Save size={14} />{saving ? "Guardando…" : "Guardar cambios"}</button></div></form> : <dl className="mt-6 grid gap-5 sm:grid-cols-2">{[
          { icon: BriefcaseBusiness, label: "Identificador", value: employee.employee_number },
          { icon: Mail, label: "Correo", value: employee.email || "No registrado" },
          { icon: MapPin, label: "Sucursal", value: employee.branch?.name || "Sin sucursal asignada" },
          { icon: CalendarDays, label: "Fecha de ingreso", value: employee.hired_on || "No registrada" },
          { icon: CalendarDays, label: "Expediente creado", value: new Date(employee.created_at).toLocaleDateString("es-MX", { dateStyle: "long", timeZone: employee.branch?.timezone ?? "America/Mexico_City" }) },
        ].map(({ icon: Icon, label, value }) => <div key={label} className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500"><Icon size={16} /></span><div><dt className="text-[11px] font-medium text-slate-400">{label}</dt><dd className="mt-1 text-sm font-semibold text-slate-800">{value}</dd></div></div>)}</dl>}
      </section>

      <aside className="space-y-5"><section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"><h2 className="text-sm font-bold text-slate-900">Horario actual</h2>{employee.currentSchedule ? <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-800">{employee.currentSchedule.name}</p><p className="mt-1 text-xs text-slate-500">{employee.currentSchedule.startLocal?.slice(0, 5) ?? "Variable"}{employee.currentSchedule.endLocal ? ` – ${employee.currentSchedule.endLocal.slice(0, 5)}` : ""}</p><p className="mt-3 text-[11px] text-slate-400">Vigencia desde {employee.currentSchedule.startsOn}{employee.currentSchedule.endsOn ? ` hasta ${employee.currentSchedule.endsOn}` : ""}</p></div> : <p className="mt-3 text-xs leading-relaxed text-slate-500">No hay una asignación de horario vigente para este expediente.</p>}<Link href={`/admin/horarios?employeeId=${employee.id}`} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white hover:bg-blue-900"><CalendarDays size={14} />Administrar horario</Link></section><section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5"><p className="text-xs font-semibold text-blue-900">Historial protegido</p><p className="mt-1.5 text-xs leading-relaxed text-blue-800/75">Al desactivar el expediente, se conserva su relación laboral y cualquier registro histórico.</p></section></aside>
    </div>

    <EmployeeCredentials employee={employee} />
  </div>;
}
