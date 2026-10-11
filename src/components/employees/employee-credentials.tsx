"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import NextImage from "next/image";
import QRCode from "qrcode";
import { BadgeCheck, Download, KeyRound, LoaderCircle, Printer, QrCode, RefreshCw, ShieldAlert, Trash2, X } from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";

type Credential = {
  employeeActive: boolean;
  qrStatus: "not_issued" | "active" | "revoked";
  issuedAt: string | null;
  revokedAt: string | null;
  pinConfigured: boolean;
};

type Props = {
  employee: { id: string; employee_number: string; first_name: string; last_name: string; branch: { name: string } | null };
};

function safeFilename(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "empleado";
}

async function makeCredentialCard(qrDataUrl: string, employee: Props["employee"], companyName: string) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo leer el código QR."));
    image.src = qrDataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 760;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la credencial.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#14264a";
  context.fillRect(0, 0, canvas.width, 180);
  context.fillStyle = "#93c5fd";
  context.font = "600 24px Arial, sans-serif";
  context.fillText("CONTROL DE ASISTENCIA", 64, 62);
  context.fillStyle = "#ffffff";
  context.font = "700 40px Arial, sans-serif";
  context.fillText(companyName, 64, 125, 790);

  context.fillStyle = "#14264a";
  context.font = "700 48px Arial, sans-serif";
  context.fillText(`${employee.first_name} ${employee.last_name}`, 64, 292, 730);
  context.fillStyle = "#64748b";
  context.font = "600 22px Arial, sans-serif";
  context.fillText("IDENTIFICADOR DE EMPLEADO", 64, 354);
  context.fillStyle = "#1e293b";
  context.font = "700 34px Arial, sans-serif";
  context.fillText(employee.employee_number, 64, 402, 700);
  context.fillStyle = "#64748b";
  context.font = "24px Arial, sans-serif";
  context.fillText(employee.branch?.name ?? "Sin sucursal", 64, 468, 700);
  context.fillStyle = "#334155";
  context.font = "22px Arial, sans-serif";
  context.fillText("Presenta esta credencial al supervisor", 64, 574);
  context.fillText("para registrar tu asistencia.", 64, 608);

  context.fillStyle = "#f1f5f9";
  context.fillRect(820, 220, 320, 320);
  context.drawImage(image, 836, 236, 288, 288);
  context.fillStyle = "#64748b";
  context.font = "600 19px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("QR PERSONAL", 980, 580);
  context.textAlign = "left";
  context.fillStyle = "#cbd5e1";
  context.fillRect(64, 676, 1072, 2);
  context.fillStyle = "#64748b";
  context.font = "18px Arial, sans-serif";
  context.fillText("Credencial personal e intransferible", 64, 718);
  return canvas;
}

function makePdf(canvas: HTMLCanvasElement) {
  const jpegUrl = canvas.toDataURL("image/jpeg", 0.96);
  const binaryJpeg = atob(jpegUrl.split(",")[1]);
  const jpegBytes = Uint8Array.from(binaryJpeg, (char) => char.charCodeAt(0));
  const content = "q 790 0 0 500 26 47 cm /CARD Do Q\n";
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? enc.encode(value) : value;
    chunks.push(bytes); total += bytes.length;
  };
  const offsets = [0];
  const object = (id: number, body: string) => { offsets[id] = total; push(`${id} 0 obj\n${body}\nendobj\n`); };
  push("%PDF-1.4\n%QR\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /CARD 4 0 R >> >> /Contents 5 0 R >>");
  offsets[4] = total;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
  push(jpegBytes); push("\nendstream\nendobj\n");
  const contentBytes = enc.encode(content);
  offsets[5] = total;
  push(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`); push(contentBytes); push("endstream\nendobj\n");
  const xrefStart = total;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (let id = 1; id <= 5; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; }
  return new Blob([output], { type: "application/pdf" });
}

export function EmployeeCredentials({ employee }: Props) {
  const { company } = useAdminContext();
  const [credential, setCredential] = useState<Credential | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [credentialCardUrl, setCredentialCardUrl] = useState("");
  const loading = loadedKey !== `${company.companyId}:${employee.id}`;
  const query = `?companyId=${encodeURIComponent(company.companyId)}`;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/employees/${employee.id}/qr${query}`, { cache: "no-store", signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "No se pudo consultar el estado de credenciales.");
    setCredential(payload.credential as Credential);
    setError("");
    setLoadedKey(`${company.companyId}:${employee.id}`);
  }, [company.companyId, employee.id, query]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void refresh(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "No se pudo cargar el estado de credenciales.");
        setLoadedKey(`${company.companyId}:${employee.id}`);
      }
    }); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [company.companyId, employee.id, refresh]);

  async function issue(replace: boolean) {
    if (replace && !window.confirm(`¿Regenerar el QR de ${employee.first_name} ${employee.last_name}? El código anterior dejará de funcionar inmediatamente.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/employees/${employee.id}/qr${query}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replace }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "No se pudo emitir el QR.");
      const image = await QRCode.toDataURL(payload.token as string, { errorCorrectionLevel: "H", width: 512, margin: 4, color: { dark: "#14264a", light: "#ffffff" } });
      const card = await makeCredentialCard(image, employee, company.companyName);
      setCredential(payload.credential as Credential);
      setQrDataUrl(image);
      setCredentialCardUrl(card.toDataURL("image/png"));
      setNotice(replace ? "QR regenerado. El anterior ya fue revocado." : "QR emitido correctamente.");
      setLoadedKey(`${company.companyId}:${employee.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo emitir el QR."); }
    finally { setBusy(false); }
  }

  async function revoke() {
    if (!window.confirm(`¿Revocar definitivamente el QR de ${employee.first_name} ${employee.last_name}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/employees/${employee.id}/qr${query}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "No se pudo revocar el QR.");
      setCredential((current) => current ? { ...current, qrStatus: "revoked", revokedAt: payload.credential.revokedAt } : current);
      setQrDataUrl(""); setCredentialCardUrl(""); setNotice("QR revocado. El código anterior ya no puede registrar asistencia.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo revocar el QR."); }
    finally { setBusy(false); }
  }

  async function savePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const pin = String(new FormData(form).get("pin") ?? "");
    if (!/^\d{6,12}$/.test(pin)) { setError("El PIN debe tener de 6 a 12 dígitos."); return; }
    if (credential?.pinConfigured && !window.confirm("¿Restablecer el PIN? El nuevo PIN reemplazará al anterior.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/employees/${employee.id}/pin${query}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "No se pudo guardar el PIN.");
      setCredential((current) => current ? { ...current, pinConfigured: true } : current);
      form.reset(); setNotice("PIN guardado. Solo se conserva el hash; el valor ya no se puede consultar.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el PIN."); }
    finally { setBusy(false); }
  }

  function closeQr() { setQrDataUrl(""); setCredentialCardUrl(""); }
  function downloadPng() {
    if (!credentialCardUrl) return;
    const anchor = document.createElement("a"); anchor.href = credentialCardUrl; anchor.download = `credencial-${safeFilename(employee.employee_number)}.png`; anchor.click();
  }
  async function downloadPdf() {
    if (!credentialCardUrl) return;
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const loadedImage = new window.Image();
        loadedImage.onload = () => resolve(loadedImage);
        loadedImage.onerror = () => reject(new Error("No se pudo preparar la credencial."));
        loadedImage.src = credentialCardUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo preparar la credencial.");
      context.drawImage(image, 0, 0);
      const blob = makePdf(canvas); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `credencial-${safeFilename(employee.employee_number)}.pdf`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    catch { setError("No se pudo preparar el PDF. Prueba de nuevo o usa Imprimir."); }
  }
  function printCredential() {
    if (!credentialCardUrl) return;
    const popup = window.open("", "_blank", "width=760,height=900");
    if (!popup) { setError("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para imprimir."); return; }
    popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Credencial QR</title><style>@page{size:landscape;margin:12mm}body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#14264a}.card{display:block;width:min(100%,1000px);height:auto;margin:24px auto}.hint{text-align:center;color:#64748b;font-size:14px}@media print{body{padding:0}.hint{display:none}.card{width:100%;margin:0}}</style></head><body><p class="hint">Usa el diálogo de impresión para imprimir o guardar como PDF.</p><img class="card" src="${credentialCardUrl}" alt="Credencial QR de empleado"><script>window.addEventListener('load',()=>window.setTimeout(()=>window.print(),250))<\/script></body></html>`);
    popup.document.close();
  }

  return <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-700"><QrCode size={17} /></span><div><h2 className="text-sm font-bold text-slate-900">Credencial QR</h2><p className="mt-1 text-xs text-slate-500">Credencial personal para identificación en asistencia.</p></div></div><span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${credential?.qrStatus === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{loading ? "Consultando…" : credential?.qrStatus === "active" ? "Activo" : credential?.qrStatus === "revoked" ? "Revocado" : "Sin emitir"}</span></div>
    {error ? <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">{error}</p> : null}
    {notice ? <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">{notice}</p> : null}
    <div className="mt-5 grid gap-5 md:grid-cols-2">
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-800">Código QR</p><p className="mt-1 text-xs leading-relaxed text-slate-500">El valor completo solo se muestra en pantalla al emitirlo. Si se pierde, regenera el código anterior dejará de funcionar.</p><div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || loading || !credential?.employeeActive} onClick={() => void issue(credential?.qrStatus === "active")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#14264a] px-3 text-xs font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle size={14} className="animate-spin" /> : credential?.qrStatus === "active" ? <RefreshCw size={14} /> : <QrCode size={14} />}{credential?.qrStatus === "active" ? "Regenerar" : "Generar QR"}</button>{credential?.qrStatus === "active" ? <button disabled={busy} onClick={() => void revoke()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-200 px-3 text-xs font-semibold text-rose-700 disabled:opacity-50"><Trash2 size={14} />Revocar</button> : null}</div>{credential?.issuedAt ? <p className="mt-3 text-[11px] text-slate-400">Emitido {new Date(credential.issuedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</p> : null}</div>
      <div className="rounded-xl border border-slate-100 p-4"><div className="flex items-center gap-2"><KeyRound size={15} className="text-indigo-600" /><p className="text-xs font-semibold text-slate-800">PIN de seguridad opcional</p></div><p className="mt-1 text-xs leading-relaxed text-slate-500">Solo se almacena un hash. La verificación con límite de intentos queda preparada para el flujo de escaneo de una etapa posterior.</p><form onSubmit={(event) => void savePin(event)} className="mt-3 flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor={`employee-pin-${employee.id}`}>PIN numérico de 6 a 12 dígitos</label><input id={`employee-pin-${employee.id}`} name="pin" type="password" inputMode="numeric" pattern="[0-9]{6,12}" minLength={6} maxLength={12} autoComplete="new-password" required placeholder="6 a 12 dígitos" className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100" /><button disabled={busy || loading || !credential?.employeeActive} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-50">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <BadgeCheck size={14} />}{credential?.pinConfigured ? "Restablecer PIN" : "Guardar PIN"}</button></form>{credential?.pinConfigured ? <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-700"><ShieldAlert size={13} />PIN configurado; no se puede recuperar.</p> : null}</div>
    </div>
    {qrDataUrl ? <div role="dialog" aria-modal="true" aria-labelledby={`qr-dialog-title-${employee.id}`} className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-slate-950/55 p-4"><div className="my-auto w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-3"><div><h3 id={`qr-dialog-title-${employee.id}`} className="text-base font-bold text-slate-900">Credencial lista para entregar</h3><p className="mt-1 text-xs text-slate-500">Descárgala o imprímela ahora. El QR completo no se podrá recuperar después.</p></div><button aria-label="Cerrar" onClick={closeQr} className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={17} /></button></div><div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-slate-50"><NextImage src={credentialCardUrl} alt={`Credencial QR de ${employee.first_name} ${employee.last_name}`} width={1200} height={760} className="h-auto w-full" unoptimized /></div><div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3"><button onClick={downloadPng} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700"><Download size={15} />Descargar PNG</button><button onClick={() => void downloadPdf()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700"><Download size={15} />Descargar PDF</button><button onClick={printCredential} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#14264a] px-3 text-xs font-semibold text-white"><Printer size={15} />Imprimir</button></div><p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"><ShieldAlert size={16} className="mt-0.5 shrink-0" /><span><strong>Guarda el archivo de forma segura.</strong> Al cerrar esta ventana, el QR en claro se elimina de la memoria de la página. Si pierdes la credencial, tendrás que regenerarla y entregar la nueva.</span></p><div className="mt-4 flex justify-end"><button onClick={closeQr} className="inline-flex h-10 items-center rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700">Cerrar</button></div></div></div> : null}
  </section>;
}
