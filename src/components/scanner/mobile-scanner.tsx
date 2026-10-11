"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { Camera, CameraOff, CheckCircle2, CircleAlert, Clock3, LoaderCircle, RotateCcw, ShieldCheck, Smartphone } from "lucide-react";
import { isCurrentContextRequest } from "@/lib/http/request-origin";

type Branch = { id: string; name: string; timezone: string };
type Action = { type: "clock_in" | "break_start" | "break_end" | "clock_out"; label: string };
type BreakRule = { id: string; code: string; name: string; countsAsWork: boolean };
type Movement = { employeeName: string; eventType: Action["type"]; occurredAt: string };
type Context = { companyId: string; companyName: string; supervisorName: string; authorized: boolean; branchId: string | null; branchName: string | null; timezone: string | null; branches: Branch[]; requestStatus: string; recentMovements: Movement[] };
type Preview = { employeeName: string; allowedActions: Action[]; breakRules: BreakRule[] };
type Success = { employeeName: string; eventType: Action["type"]; occurredAt: string; duplicate?: boolean };
type ContextLoadState = "loading" | "loaded" | "error";

class ApiResponseError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

const eventLabels: Record<Action["type"], string> = { clock_in: "Entrada al trabajo", break_start: "Salida a comer", break_end: "Regreso de comida", clock_out: "Salida del trabajo" };
const buttonClass = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50";

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiResponseError(body?.error?.message ?? "No fue posible completar la operación.", response.status, body?.error?.code);
  return body as T;
}

export function MobileScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const scanHandledRef = useRef(false);
  const [contexts, setContexts] = useState<Context[]>([]);
  const [companyId, setCompanyId] = useState("");
  const context = contexts.find((item) => item.companyId === companyId) ?? contexts[0];
  const [error, setError] = useState("");
  const [contextLoadState, setContextLoadState] = useState<ContextLoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [qrToken, setQrToken] = useState("");
  const [pin, setPin] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedAction, setSelectedAction] = useState<Action["type"] | "">("");
  const [breakRuleId, setBreakRuleId] = useState("");
  const [success, setSuccess] = useState<Success | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [branchId, setBranchId] = useState("");
  const selectedBranchId = context?.branches.some((branch) => branch.id === branchId) ? branchId : context?.branches[0]?.id ?? "";
  const idempotencyRef = useRef("");
  const contextRequestRef = useRef<AbortController | null>(null);
  const contextRequestIdRef = useRef(0);
  const contextLoadedOnceRef = useRef(false);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraActive(false);
  }, [setCameraActive]);

  const loadContext = useCallback(async () => {
    contextRequestRef.current?.abort();
    const controller = new AbortController();
    contextRequestRef.current = controller;
    const requestId = ++contextRequestIdRef.current;
    if (!contextLoadedOnceRef.current) setContextLoadState("loading");
    try {
      const response = await fetch("/api/supervisor/scanner/context", { method: "POST", cache: "no-store", signal: controller.signal });
      const body = await readJson<{ contexts: Context[] }>(response);
      if (!isCurrentContextRequest(requestId, contextRequestIdRef.current, controller.signal)) return;
      setContexts(body.contexts);
      setCompanyId((current) => body.contexts.some((item) => item.companyId === current) ? current : body.contexts[0]?.companyId ?? "");
      setError("");
      contextLoadedOnceRef.current = true;
      setContextLoadState("loaded");
    } catch (reason) {
      if (!isCurrentContextRequest(requestId, contextRequestIdRef.current, controller.signal)) return;
      if (reason instanceof ApiResponseError && (reason.status === 401 || reason.status === 403)) setContexts([]);
      setContextLoadState("error");
      setError(reason instanceof Error ? reason.message : "No fue posible validar el dispositivo.");
    } finally {
      if (requestId === contextRequestIdRef.current) contextRequestRef.current = null;
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadContext(), 0);
    const interval = window.setInterval(() => void loadContext(), 12000);
    return () => {
      contextRequestIdRef.current += 1;
      contextRequestRef.current?.abort();
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      controlsRef.current?.stop();
    };
  }, [loadContext]);

  async function startCamera() {
    if (!videoRef.current || !context?.authorized) return;
    setError(""); setSuccess(null);
    scanHandledRef.current = false;
    try {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (!result || scanHandledRef.current) return;
        scanHandledRef.current = true;
        const value = result.getText();
        if (!/^[A-Za-z0-9_-]{40,60}$/.test(value)) {
          controlsRef.current?.stop();
          controlsRef.current = null;
          setCameraActive(false);
          setError("El código no corresponde a una credencial QR válida.");
          return;
        }
        controlsRef.current?.stop();
        controlsRef.current = null;
        setCameraActive(false);
        setQrToken(value);
        setPin("");
        setPreview(null);
        setSelectedAction("");
        setBreakRuleId("");
      });
      controlsRef.current = controls;
      setCameraActive(true);
    } catch {
      setCameraActive(false);
      setError("No se pudo abrir la cámara. Revisa el permiso del navegador y usa HTTPS o localhost.");
    }
  }

  function clearEmployee() {
    stopCamera(); setQrToken(""); setPin(""); setPreview(null); setSelectedAction(""); setBreakRuleId(""); setSuccess(null); setError(""); idempotencyRef.current = "";
  }

  async function verifyPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/attendance/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", companyId: context.companyId, qrToken, pin }) });
      const body = await readJson<{ result: Preview }>(response);
      setPreview(body.result);
      setSelectedAction(body.result.allowedActions[0]?.type ?? "");
      const defaultRule = body.result.breakRules.find((rule) => rule.countsAsWork && /comida|alimento/i.test(`${rule.code} ${rule.name}`)) ?? body.result.breakRules.find((rule) => rule.countsAsWork) ?? body.result.breakRules[0];
      setBreakRuleId(defaultRule?.id ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible validar el PIN."); }
    finally { setBusy(false); }
  }

  async function confirmMovement() {
    if (!context || !preview || !selectedAction) return;
    if (selectedAction === "break_start" && !breakRuleId) { setError("Selecciona la regla que corresponde a este descanso."); return; }
    if (!idempotencyRef.current) idempotencyRef.current = crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/attendance/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", companyId: context.companyId, qrToken, pin, event: selectedAction, breakRuleId: selectedAction === "break_start" ? breakRuleId : null, idempotencyKey: idempotencyRef.current }) });
      const body = await readJson<{ result: Success }>(response);
      stopCamera(); setSuccess(body.result); setQrToken(""); setPin(""); setPreview(null); setSelectedAction(""); idempotencyRef.current = "";
      void loadContext();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo registrar el movimiento."); }
    finally { setBusy(false); }
  }

  async function requestDevice() {
    if (!context || !selectedBranchId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/supervisor/device-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: context.companyId, branchId: selectedBranchId, label: deviceLabel.trim() || `Celular de ${context.supervisorName}` }) });
      await readJson(response); await loadContext();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible solicitar autorización."); }
    finally { setBusy(false); }
  }

  const selected = preview?.allowedActions.find((action) => action.type === selectedAction);

  return <div className="mx-auto max-w-2xl space-y-5">
    <header className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-blue-700">Registro de jornada</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Escáner del supervisor</h1><p className="mt-1 text-sm text-slate-500">Escanea la credencial y confirma el movimiento con el PIN del empleado.</p></div><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700"><ShieldCheck size={21} /></div></header>
    {contexts.length > 1 ? <label className="block text-xs font-medium text-slate-600">Empresa<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">Selecciona empresa</option>{contexts.map((item) => <option key={item.companyId} value={item.companyId}>{item.companyName}</option>)}</select></label> : null}
    {error ? <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert className="shrink-0" size={17} />{error}</div> : null}
    {!contexts.length && contextLoadState === "loading" ? <p role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Cargando la asignación de supervisor…</p> : null}
    {!contexts.length && contextLoadState === "loaded" ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><strong>Sin asignación de supervisor.</strong><p className="mt-1">No se encontró una membresía activa de supervisor. Contacta al administrador de tu empresa.</p></section> : null}
    {context && !context.branches.length ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><strong>Sin sucursal asignada.</strong><p className="mt-1">Tu membresía de supervisor no tiene sucursales activas asignadas.</p></section> : null}
    {context && context.branches.length > 0 && !context.authorized ? <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><Smartphone size={19} /></div><div><h2 className="font-semibold text-slate-900">Dispositivo sin autorización</h2><p className="mt-0.5 text-xs text-slate-500">{context.supervisorName} · {context.companyName}</p></div></div><p className="text-sm text-slate-600">Un administrador debe aprobar este navegador antes de habilitar la cámara y el registro de asistencia.</p>{context.requestStatus === "pending" ? <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">Solicitud enviada. Esta página comprobará la aprobación automáticamente.</p> : <><label className="block text-xs font-medium text-slate-600">Sucursal<select value={selectedBranchId} onChange={(event) => setBranchId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">{context.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className="block text-xs font-medium text-slate-600">Nombre del dispositivo<input value={deviceLabel || `Celular de ${context.supervisorName}`} onChange={(event) => setDeviceLabel(event.target.value)} maxLength={100} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" /></label><button disabled={busy || !selectedBranchId} onClick={() => void requestDevice()} className={buttonClass}>{busy ? <LoaderCircle className="animate-spin" size={17} /> : <Smartphone size={17} />}Solicitar autorización</button></>}</section> : null}
    {context?.authorized ? <>
      <section className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div><p className="text-sm font-semibold text-emerald-900">{context.companyName} · {context.branchName}</p><p className="mt-1 text-xs text-emerald-800">{context.supervisorName} · Dispositivo autorizado</p></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-800">ACTIVO</span></section>
      {success ? <section role="status" className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={23} /><div><h2 className="font-semibold text-slate-950">Movimiento registrado</h2><p className="mt-1 text-sm text-slate-700">{success.employeeName} · {eventLabels[success.eventType]}</p><p className="mt-1 text-xs text-slate-500">Hora oficial: {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: context.timezone ?? undefined }).format(new Date(success.occurredAt))}</p>{success.duplicate ? <p className="mt-1 text-xs text-slate-500">Se devolvió el registro existente por reintento.</p> : null}</div></div><button onClick={clearEmployee} className={`${buttonClass} mt-5 w-full`}><RotateCcw size={17} />Volver al escáner</button></section> : null}
      {!success && !preview ? <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-950"><video ref={videoRef} muted playsInline className="size-full object-cover" />{!cameraActive ? <div className="absolute inset-0 grid place-items-center text-center text-white"><div><CameraOff className="mx-auto mb-2 opacity-70" size={30} /><p className="text-sm">La cámara se activa solo al iniciar el escaneo.</p></div></div> : <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="size-[62%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(2,6,23,.35)]" /></div>}</div><p className="text-center text-sm text-slate-600">Alinea el código QR del empleado dentro del marco. Escanear no registra la asistencia.</p><button onClick={() => cameraActive ? stopCamera() : void startCamera()} className={`${buttonClass} w-full`}>{cameraActive ? <><CameraOff size={18} />Cerrar cámara</> : <><Camera size={18} />Abrir cámara</>}</button></section> : null}
      {qrToken && !success && !preview ? <form onSubmit={verifyPin} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><h2 className="font-semibold text-slate-950">Verificación del empleado</h2><p className="mt-1 text-sm text-slate-500">Introduce el PIN para consultar los movimientos permitidos.</p></div><label className="block text-sm font-medium text-slate-700">PIN del empleado<input autoFocus inputMode="numeric" type="password" pattern="[0-9]{6,12}" minLength={6} maxLength={12} autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))} className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 px-4 text-lg tracking-[.25em]" required /></label><button disabled={busy || pin.length < 6} className={`${buttonClass} w-full`}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldCheck size={18} />}Validar PIN</button><button type="button" onClick={clearEmployee} className="w-full py-2 text-sm text-slate-500">Cancelar y borrar lectura</button></form> : null}
      {preview && !success ? <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Empleado validado</p><h2 className="mt-1 text-xl font-semibold text-slate-950">{preview.employeeName}</h2></div>{preview.allowedActions.length ? <><fieldset><legend className="text-sm font-medium text-slate-700">Selecciona el movimiento</legend><div className="mt-2 grid gap-2">{preview.allowedActions.map((action) => <label key={action.type} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 ${selectedAction === action.type ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}><input type="radio" name="movement" value={action.type} checked={selectedAction === action.type} onChange={() => setSelectedAction(action.type)} className="size-4 text-blue-700" /><span className="text-sm font-medium text-slate-800">{action.label}</span></label>)}</div></fieldset>{selectedAction === "break_start" ? <label className="block text-sm font-medium text-slate-700">Tipo de descanso<select value={breakRuleId} onChange={(event) => setBreakRuleId(event.target.value)} className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-white px-3">{preview.breakRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · {rule.countsAsWork ? "cuenta como trabajo" : "no computable"}</option>)}</select></label> : null}<div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Confirma que el empleado esté presente. La hora oficial se asigna en el servidor al confirmar.</div><button disabled={busy || !selected} onClick={() => void confirmMovement()} className={`${buttonClass} w-full`}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}Confirmar {selected?.label.toLowerCase() ?? "movimiento"}</button></> : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No hay movimientos válidos para este estado. Vuelve a escanear después de revisar la jornada.</p>}<button disabled={busy} onClick={clearEmployee} className="w-full py-2 text-sm text-slate-500">Cancelar y volver al escáner</button></section> : null}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Clock3 size={17} className="text-blue-700" /><h2 className="font-semibold text-slate-900">Últimos movimientos</h2></div>{context.recentMovements?.length ? <ul className="mt-3 divide-y divide-slate-100">{context.recentMovements.slice(0, 8).map((movement, index) => <li key={`${movement.occurredAt}:${index}`} className="flex justify-between gap-3 py-2.5 text-sm"><span className="truncate text-slate-800">{movement.employeeName}<span className="ml-2 text-xs text-slate-500">{eventLabels[movement.eventType]}</span></span><time className="shrink-0 text-xs text-slate-500">{new Intl.DateTimeFormat("es-MX", { timeStyle: "short", timeZone: context.timezone ?? undefined }).format(new Date(movement.occurredAt))}</time></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">Aún no hay movimientos recientes registrados desde este dispositivo.</p>}</section>
    </> : null}
  </div>;
}
