"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, RefreshCw, ShieldCheck, Smartphone, UserRound, X } from "lucide-react";
import { useAdminContext } from "@/components/admin/admin-context";

type Branch = { id: string; name: string };
type Supervisor = { membershipId: string; name: string; email: string; branches: string[] };
type Request = { id: string; supervisorName: string; email: string; branchId: string; branchName: string; label: string; status: string; requestedAt: string };
type Device = { id: string; supervisorName: string; branchName: string; label: string; active: boolean; createdAt: string };

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(24,39,75,.035)]";

export function SupervisorManagement() {
  const { company } = useAdminContext();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [assignmentsResponse, devicesResponse] = await Promise.all([
        fetch(`/api/supervisors?companyId=${encodeURIComponent(company.companyId)}`, { cache: "no-store" }), fetch(`/api/supervisor-devices?companyId=${encodeURIComponent(company.companyId)}`, { cache: "no-store" }),
      ]);
      const [assignmentsBody, devicesBody] = await Promise.all([assignmentsResponse.json(), devicesResponse.json()]);
      if (!assignmentsResponse.ok) throw new Error(assignmentsBody.error?.message ?? "No fue posible cargar supervisores.");
      if (!devicesResponse.ok) throw new Error(devicesBody.error?.message ?? "No fue posible cargar dispositivos.");
      const assigned = assignmentsBody.data ?? {};
      setBranches(assigned.branches ?? []);
      setSupervisors(assigned.supervisors ?? []);
      setRequests(devicesBody.requests ?? []);
      setDevices(devicesBody.devices ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible cargar la información.");
    }
  }, [company.companyId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function update(url: string, method: string, body?: object, key = "operation") {
    setBusy(key); setError(""); setNotice("");
    try {
      const separator = url.includes("?") ? "&" : "?";
      const scopedUrl = `${url}${separator}companyId=${encodeURIComponent(company.companyId)}`;
      const response = await fetch(scopedUrl, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "La operación no se completó.");
      setNotice("Los cambios se guardaron correctamente.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "La operación no se completó."); }
    finally { setBusy(""); }
  }

  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Acceso a sucursales</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Supervisores y dispositivos</h1><p className="mt-1 text-sm text-slate-500">Administra los dispositivos autorizados para registrar asistencia en {company.companyName}.</p></div>
      <button onClick={() => void refresh()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700"><RefreshCw size={15} />Actualizar</button>
    </header>
    {notice ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
    {error ? <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert size={17} />{error}</div> : null}
    <section className={`${card} p-5`}>
      <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><UserRound size={19} /></div><div><h2 className="font-semibold text-slate-900">Asignación a sucursales</h2><p className="mt-0.5 text-xs text-slate-500">Solo aparecen usuarios con membresía activa y rol supervisor.</p></div></div>
      {!supervisors.length ? <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No hay membresías de supervisor activas. Primero crea o asigna la membresía con rol supervisor en la configuración de usuarios.</p> : <div className="mt-5 space-y-3">{supervisors.map((supervisor) => <div key={supervisor.membershipId} className="rounded-xl border border-slate-100 p-4"><div className="font-semibold text-sm text-slate-900">{supervisor.name}</div><div className="mt-0.5 text-xs text-slate-500">{supervisor.email}</div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">{branches.map((branch) => <label key={branch.id} className="inline-flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={supervisor.branches.includes(branch.id)} disabled={busy.length > 0} onChange={(event) => void update("/api/supervisors", "PATCH", { membershipId: supervisor.membershipId, branchId: branch.id, assigned: event.target.checked }, `${supervisor.membershipId}:${branch.id}`)} className="size-4 rounded border-slate-300 text-blue-700 focus:ring-blue-500" />{branch.name}</label>)}</div></div>)}</div>}
    </section>
    <section className={`${card} overflow-hidden`}>
      <div className="flex items-center gap-3 border-b border-slate-100 p-5"><div className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700"><ShieldCheck size={19} /></div><div><h2 className="font-semibold text-slate-900">Solicitudes de dispositivos</h2><p className="mt-0.5 text-xs text-slate-500">Aprueba la solicitud para habilitar el navegador del supervisor.</p></div></div>
      {!requests.length ? <p className="p-5 text-sm text-slate-500">Todavía no hay solicitudes.</p> : <div className="divide-y divide-slate-100">{requests.map((request) => <div key={request.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-sm text-slate-900">{request.label} <span className="font-normal text-slate-500">· {request.branchName}</span></div><p className="mt-1 text-xs text-slate-500">{request.supervisorName} · {request.email} · {new Date(request.requestedAt).toLocaleString("es-MX")}</p><p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{request.status}</p></div>{request.status === "pending" ? <div className="flex gap-2"><button disabled={Boolean(busy)} onClick={() => void update("/api/supervisor-devices", "PATCH", { requestId: request.id, approve: true }, request.id)} className="h-9 rounded-lg bg-blue-700 px-3 text-xs font-semibold text-white disabled:opacity-50">Aprobar</button><button disabled={Boolean(busy)} onClick={() => void update("/api/supervisor-devices", "PATCH", { requestId: request.id, approve: false }, request.id)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 disabled:opacity-50">Rechazar</button></div> : null}</div>)}</div>}
    </section>
    <section className={`${card} overflow-hidden`}>
      <div className="flex items-center gap-3 border-b border-slate-100 p-5"><div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Smartphone size={19} /></div><div><h2 className="font-semibold text-slate-900">Dispositivos registrados</h2><p className="mt-0.5 text-xs text-slate-500">La revocación bloquea de inmediato el siguiente registro.</p></div></div>
      {!devices.length ? <p className="p-5 text-sm text-slate-500">Todavía no hay dispositivos autorizados.</p> : <div className="divide-y divide-slate-100">{devices.map((device) => <div key={device.id} className="flex items-center justify-between gap-3 p-5"><div><div className="font-semibold text-sm text-slate-900">{device.label} <span className="font-normal text-slate-500">· {device.branchName}</span></div><p className="mt-1 text-xs text-slate-500">{device.supervisorName} · {device.active ? "Activo" : "Revocado"}</p></div>{device.active ? <button aria-label={`Revocar ${device.label}`} disabled={Boolean(busy)} onClick={() => { if (window.confirm(`¿Revocar el dispositivo ${device.label}?`)) void update(`/api/supervisor-devices/${device.id}`, "DELETE", undefined, device.id); }} className="grid size-9 place-items-center rounded-lg border border-rose-100 text-rose-600 hover:bg-rose-50 disabled:opacity-50"><X size={16} /></button> : null}</div>)}</div>}
    </section>
  </div>;
}
