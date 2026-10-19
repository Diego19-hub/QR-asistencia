"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, BriefcaseBusiness, CalendarDays, CircleAlert, Mail, MapPin, Pencil, Save, UserRound, X } from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";
import { EmployeeCredentials } from "@/components/employees/employee-credentials";

type Branch = { id: string; name: string; timezone: string };
type Employee = {
  id: string; employee_number: string; first_name: string; last_name: string; email: string | null; auth_user_id: string | null;
  branch_id: string | null; active: boolean; hired_on: string | null; terminated_on: string | null;
  created_at: string; updated_at: string; branch: Branch | null;
  currentSchedule: { id: string; name: string; kind: string; startsOn: string; endsOn: string | null; startLocal: string | null; endLocal: string | null; plannedMinutes: number } | null;
};
type EmployeePayload = { item: Employee };
type BranchPayload = { branches: Branch[] };
type EditField = "employee_number" | "first_name" | "last_name" | "email" | "hired_on" | "branch_id";

const inputClass = "mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100";

export function EmployeeDetail({ employeeId }: { employeeId: string }) {
  const { company } = useAdminContext();
  const searchParams = useSearchParams();
  const requestedReturnTo = searchParams.get("returnTo");
  const returnTo = requestedReturnTo?.startsWith("/admin/empleados?") ? requestedReturnTo : "/admin/empleados";
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editFieldErrors, setEditFieldErrors] = useState<Partial<Record<EditField, string>>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestKey = `${company.companyId}:${employeeId}`;
  const latestRequestKey = useRef(requestKey);
  const loading = loadedKey !== requestKey;

  useEffect(() => { latestRequestKey.current = requestKey; }, [requestKey]);

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
      if (!signal?.aborted && latestRequestKey.current === requestKey) {
        setEmployee((employeePayload as EmployeePayload).item);
        setBranches((listPayload as BranchPayload).branches);
        setError("");
      }
    } catch (reason) {
      if (!signal?.aborted && latestRequestKey.current === requestKey) {
        setEmployee(null);
        setBranches([]);
        setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
      }
    } finally { if (!signal?.aborted && latestRequestKey.current === requestKey) setLoadedKey(requestKey); }
  }, [company.companyId, employeeId, requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadEmployee(controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadEmployee, retry]);

  function cancelEditing() {
    if (saving) return;
    if (editDirty && !window.confirm("Hay cambios sin guardar. ¿Cancelar y descartarlos?")) return;
    setEditing(false);
    setEditDirty(false);
    setError("");
    setEditFieldErrors({});
  }

  async function saveChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employee) return;
    setSaving(true);
    setError("");
    setEditFieldErrors({});
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
        const fieldErrors: Partial<Record<EditField, string>> = {};
        for (const name of ["employee_number", "first_name", "last_name", "email", "hired_on", "branch_id"] as const) {
          if (typeof fields?.[name]?.[0] === "string") fieldErrors[name] = fields[name][0];
        }
        setEditFieldErrors(fieldErrors);
        const messages = fields ? Object.values(fields).flat() : [];
        throw new Error(messages.length ? messages.join(" ") : payload.error?.message ?? "No fue posible guardar los cambios.");
      }
      setEmployee((payload as EmployeePayload).item);
      setEditFieldErrors({});
      setEditing(false);
      setEditDirty(false);
      setNotice("Los cambios se guardaron correctamente.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
    } finally { setSaving(false); }
  }

  async function setActive(active: boolean) {
    if (!employee) return;
    if (!active && !window.confirm(`¿Desactivar a ${employee.first_name} ${employee.last_name}? Se conservará su historial laboral.`)) return;
    if (changingStatus) return;
    setChangingStatus(true);
    setError("");
    const query = new URLSearchParams({ companyId: company.companyId });
    try {
      const response = await fetch(`/api/employees/${employee.id}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "No fue posible cambiar el estado.");
      setEmployee((payload as EmployeePayload).item);
      setNotice(active ? "Empleado reactivado." : "Empleado desactivado. El historial se conservó.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado."); }
    finally { setChangingStatus(false); }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  if (loading) return <div className="mx-auto max-w-4xl animate-pulse space-y-4"><div className="h-5 w-40 rounded bg-slate-200" /><div className="h-44 rounded-2xl bg-white" /><div className="h-72 rounded-2xl bg-white" /></div>;
  if (!employee) return <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 text-center">{error ? <CircleAlert className="mx-auto text-rose-500" /> : <CircleAlert className="mx-auto text-slate-400" />}<h1 className="mt-3 text-lg font-bold text-slate-900">{error ? "No se pudo cargar el expediente" : "No encontramos el expediente"}</h1><p className="mt-1 text-sm text-slate-600">{error || "Verifica el identificador o tu acceso a esta empresa."}</p>{error ? <button type="button" onClick={() => { setLoadedKey(""); setRetry((value) => value + 1); }} className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">Reintentar</button> : null}<div><Link href={returnTo} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"><ArrowLeft size={16} />Volver a empleados</Link></div></div>;

  return <div className="mx-auto max-w-5xl space-y-6">
    <Link href={returnTo} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-white hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft size={15} />Volver al directorio</Link>
    <section className="flex flex-col justify-between gap-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:p-7">
      <div className="flex min-w-0 items-center gap-4"><span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-2xl bg-blue-50 text-lg font-bold text-blue-800 sm:size-16 sm:text-xl">{employee.first_name.slice(0, 1)}{employee.last_name.slice(0, 1)}</span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Expediente · {company.companyName}</p><h1 className="mt-1 break-words text-xl font-bold text-slate-950 sm:text-2xl">{employee.first_name} {employee.last_name}</h1><p className="mt-1 text-xs text-slate-600">ID {employee.employee_number}{employee.branch ? ` · ${employee.branch.name}` : " · Sin sucursal"}</p><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${employee.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{employee.active ? "Activo" : "Inactivo"}</span></div></div>
      <div className="flex flex-wrap gap-2">{!editing ? <><button type="button" onClick={() => { setNotice(""); setError(""); setEditDirty(false); setEditing(true); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Pencil size={14} />Editar</button><Link href={`/admin/reportes?employeeId=${employee.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><CalendarDays size={14} />Ver reporte</Link><button type="button" disabled={changingStatus} onClick={() => void setActive(!employee.active)} className={`min-h-11 rounded-xl px-3 text-xs font-semibold disabled:opacity-50 ${employee.active ? "border border-slate-200 text-slate-600 hover:border-rose-200 hover:text-rose-700" : "border border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>{changingStatus ? "Guardando…" : employee.active ? "Desactivar" : "Reactivar"}</button></> : <span className="inline-flex min-h-10 items-center rounded-full bg-blue-50 px-3 text-xs font-semibold text-blue-800">Modo edición</span>}</div>
    </section>

    {notice ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
    {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert size={16} className="mt-0.5 shrink-0" />{error}</div> : null}

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><UserRound size={17} /></span><div><h2 className="text-sm font-bold text-slate-900">Información personal y laboral</h2><p className="mt-1 text-xs text-slate-400">Expediente vinculado al área de trabajo</p></div></div>
        {editing ? <form onSubmit={saveChanges} onChangeCapture={() => setEditDirty(true)} onKeyDown={handleEditKeyDown} className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Identificador interno *<input required name="employee_number" defaultValue={employee.employee_number} maxLength={64} aria-invalid={Boolean(editFieldErrors.employee_number)} aria-describedby={editFieldErrors.employee_number ? "edit-number-error" : undefined} className={inputClass} />{editFieldErrors.employee_number ? <span id="edit-number-error" role="alert" className="mt-1 block text-xs text-rose-700">{editFieldErrors.employee_number}</span> : null}</label>
            <label className="text-xs font-semibold text-slate-700">Fecha de ingreso<input name="hired_on" type="date" defaultValue={employee.hired_on ?? ""} aria-invalid={Boolean(editFieldErrors.hired_on)} aria-describedby={editFieldErrors.hired_on ? "edit-hire-error" : undefined} className={inputClass} />{editFieldErrors.hired_on ? <span id="edit-hire-error" role="alert" className="mt-1 block text-xs text-rose-700">{editFieldErrors.hired_on}</span> : null}</label>
            <label className="text-xs font-semibold text-slate-700">Nombre(s) *<input required name="first_name" defaultValue={employee.first_name} maxLength={100} aria-invalid={Boolean(editFieldErrors.first_name)} aria-describedby={editFieldErrors.first_name ? "edit-first-name-error" : undefined} className={inputClass} autoComplete="given-name" />{editFieldErrors.first_name ? <span id="edit-first-name-error" role="alert" className="mt-1 block text-xs text-rose-700">{editFieldErrors.first_name}</span> : null}</label>
            <label className="text-xs font-semibold text-slate-700">Apellidos *<input required name="last_name" defaultValue={employee.last_name} maxLength={120} aria-invalid={Boolean(editFieldErrors.last_name)} aria-describedby={editFieldErrors.last_name ? "edit-last-name-error" : undefined} className={inputClass} autoComplete="family-name" />{editFieldErrors.last_name ? <span id="edit-last-name-error" role="alert" className="mt-1 block text-xs text-rose-700">{editFieldErrors.last_name}</span> : null}</label>
            <label className="text-xs font-semibold text-slate-700">Correo electrónico<input name="email" type="email" defaultValue={employee.email ?? ""} maxLength={254} aria-invalid={Boolean(editFieldErrors.email)} aria-describedby={editFieldErrors.email ? "edit-email-error" : undefined} className={inputClass} autoComplete="email" />{editFieldErrors.email ? <span id="edit-email-error" role="alert" className="mt-1 block text-xs text-rose-700">{editFieldErrors.email}</span> : null}</label>
            <label className="text-xs font-semibold text-slate-700">Sucursal<select name="branch_id" defaultValue={employee.branch_id ?? ""} aria-invalid={Boolean(editFieldErrors.branch_id)} aria-describedby={editFieldErrors.branch_id ? "edit-branch-error" : undefined} className={inputClass}><option value="">Sin sucursal</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>{editFieldErrors.branch_id ? <span id="edit-branch-error" role="alert" className="mt-1 block text-xs text-rose-700">{editFieldErrors.branch_id}</span> : null}</label>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><button type="button" disabled={saving} onClick={cancelEditing} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 disabled:opacity-50"><X size={14} />Cancelar</button><button disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white disabled:opacity-50"><Save size={14} />{saving ? "Guardando…" : "Guardar cambios"}</button></div>
        </form> : <dl className="mt-6 grid gap-5 sm:grid-cols-2">{[
          { icon: BriefcaseBusiness, label: "Identificador", value: employee.employee_number },
          { icon: Mail, label: "Correo", value: employee.email || "No registrado" },
          { icon: UserRound, label: "Cuenta de acceso", value: employee.auth_user_id ? "Vinculada" : "Sin vincular · puede usar QR físico" },
          { icon: MapPin, label: "Sucursal", value: employee.branch?.name || "Sin sucursal asignada" },
          { icon: CalendarDays, label: "Fecha de ingreso", value: employee.hired_on || "No registrada" },
          { icon: CalendarDays, label: "Expediente creado", value: new Date(employee.created_at).toLocaleDateString("es-MX", { dateStyle: "long", timeZone: employee.branch?.timezone ?? "America/Mexico_City" }) },
        ].map(({ icon: Icon, label, value }) => <div key={label} className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500"><Icon size={16} /></span><div><dt className="text-[11px] font-medium text-slate-400">{label}</dt><dd className="mt-1 text-sm font-semibold text-slate-800">{value}</dd></div></div>)}</dl>}
      </section>

      <aside className="space-y-5"><section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"><h2 className="text-sm font-bold text-slate-900">Horario asignado</h2>{employee.currentSchedule ? <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-800">{employee.currentSchedule.name}</p><p className="mt-1 text-sm text-slate-700">{employee.currentSchedule.startLocal?.slice(0, 5) ?? "Horario variable"}{employee.currentSchedule.endLocal ? ` – ${employee.currentSchedule.endLocal.slice(0, 5)}` : ""}</p><p className="mt-3 text-xs text-slate-600">Vigencia desde {employee.currentSchedule.startsOn}{employee.currentSchedule.endsOn ? ` hasta ${employee.currentSchedule.endsOn}` : " · Sin fecha de término"}</p></div> : <p className="mt-3 text-sm leading-relaxed text-slate-600">Este empleado no tiene un horario vigente.</p>}<Link href={`/admin/horarios?employeeId=${employee.id}`} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#14264a] px-4 text-xs font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{employee.currentSchedule ? <><CalendarDays size={14} />Administrar horario</> : <><CalendarDays size={14} />Asignar horario</>}</Link></section><section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5"><p className="text-xs font-semibold text-blue-900">Historial protegido</p><p className="mt-1.5 text-sm leading-relaxed text-blue-900/80">Al desactivar el expediente, se conserva su relación laboral y cualquier registro histórico.</p></section></aside>
    </div>

    <EmployeeCredentials employee={employee} />
  </div>;
}
