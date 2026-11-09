"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { usePathname } from "next/navigation";
import { BookOpen, CircleHelp, Send, X } from "lucide-react";

type Message = { kind: "user" | "assistant"; text: string; found?: boolean };
const pages = [
  ["/login", "Inicio de sesión"], ["/seleccionar-empresa", "Selección de empresa"], ["/admin", "Panel"],
  ["/admin/configuracion", "Configuración"], ["/admin/supervisores", "Supervisores y dispositivos"],
  ["/admin/empleados", "Empleados"], ["/admin/horarios", "Horarios"], ["/admin/asistencias", "Asistencias"],
  ["/admin/reportes", "Reportes"], ["/admin/horas-extra", "Horas extra"], ["/scanner", "Escáner"], ["/mi-qr", "Portal del empleado"],
] as const;

function currentPage(pathname: string) {
  if (pathname.startsWith("/admin/empleados/")) return "/admin/empleados";
  return pages.some(([path]) => path === pathname) ? pathname : "/admin";
}

export function HelpAssistant() {
  const pathname = usePathname();
  const employeePortal = pathname === "/mi-qr";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [description, setDescription] = useState("");
  const [page, setPage] = useState("/admin");
  const [sending, setSending] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [reportError, setReportError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      document.getElementById("help-question")?.focus();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      triggerRef.current?.focus();
      wasOpen.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = question.trim();
    if (!value || asking) return;
    setMessages((items) => [...items, { kind: "user", text: value }]);
    setQuestion(""); setAsking(true); setShowReport(false);
    try {
      const response = await fetch("/api/help/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: value }), cache: "no-store" });
      const body = await response.json() as { answer?: string; found?: boolean; error?: string };
      if (!response.ok || !body.answer) throw new Error(body.error ?? "La ayuda no está disponible en este momento.");
      setMessages((items) => [...items, { kind: "assistant", text: body.answer!, found: body.found }]);
      if (!body.found) setShowReport(true);
    } catch (reason) {
      setMessages((items) => [...items, { kind: "assistant", text: reason instanceof Error ? reason.message : "La ayuda no está disponible en este momento." }]);
      setShowReport(true);
    } finally { setAsking(false); }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const form = new FormData(event.currentTarget);
    setSending(true); setReportError(""); setReportMessage("");
    try {
      const response = await fetch("/api/help/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description, page, website: form.get("website") }), cache: "no-store" });
      const body = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo enviar el reporte.");
      setReportMessage(body.message ?? "Reporte enviado."); setDescription("");
    } catch (reason) { setReportError(reason instanceof Error ? reason.message : "No se pudo enviar el reporte."); }
    finally { setSending(false); }
  }

  return <>
    <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-controls="help-dialog" aria-expanded={open} onClick={() => { setPage(currentPage(pathname)); setOpen((value) => !value); }} className={`fixed ${employeePortal ? "bottom-24 md:bottom-6" : "bottom-4 sm:bottom-6"} right-4 z-[60] inline-flex min-h-12 items-center gap-2 rounded-full bg-blue-700 px-5 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 active:scale-[.98] sm:right-6`}>
      <CircleHelp size={19} aria-hidden="true" />Ayuda
    </button>
    {open ? <section id="help-dialog" role="dialog" aria-modal="false" aria-labelledby="help-assistant-title" className={`fixed inset-x-3 ${employeePortal ? "bottom-40 max-h-[min(66dvh,calc(100dvh-11rem))] md:bottom-24 md:max-h-[min(76dvh,680px)]" : "bottom-[4.5rem] max-h-[min(76dvh,680px)] sm:bottom-24"} z-[60] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[min(420px,calc(100vw-2rem))]`}>
      <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3"><div className="flex items-center gap-2"><BookOpen size={18} className="text-blue-700" /><div><h2 id="help-assistant-title" className="text-sm font-bold text-slate-900">Ayuda de QR-asistencia</h2><p className="text-xs text-slate-500">Respuestas basadas en el manual</p></div></div><button type="button" onClick={() => setOpen(false)} aria-label="Cerrar ayuda" className="grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><X size={18} /></button></header>
      <div aria-live="polite" className="min-h-28 flex-1 space-y-3 overflow-y-auto p-4">
        {!messages.length ? <p className="rounded-xl bg-blue-50 p-3 text-sm leading-6 text-blue-950">Pregunta cómo iniciar sesión, cambiar de empresa, administrar usuarios, usar el escáner, consultar tu horario o ver tu QR. Solo responderé con información del manual.</p> : null}
        {messages.map((message, index) => <article key={`${message.kind}-${index}`} className={`rounded-xl p-3 text-sm leading-6 ${message.kind === "user" ? "ml-6 bg-slate-100 text-slate-900" : "mr-3 bg-blue-50 text-blue-950"}`}><p className="mb-1 text-xs font-semibold">{message.kind === "user" ? "Tú" : "Ayuda"}</p><p className="whitespace-pre-wrap">{message.text}</p>{message.kind === "assistant" && message.found ? <p className="mt-2 text-xs text-blue-800">Fuente: docs/MANUAL-USUARIO.md</p> : null}</article>)}
        {asking ? <p role="status" className="text-sm text-slate-500">Buscando en el manual…</p> : null}
      </div>
      <form onSubmit={(event) => void ask(event)} className="flex gap-2 border-t border-slate-100 p-3"><label htmlFor="help-question" className="sr-only">Pregunta</label><input id="help-question" value={question} maxLength={300} onChange={(event) => setQuestion(event.target.value)} placeholder="Escribe tu pregunta" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /><button type="submit" disabled={asking || !question.trim()} aria-label="Enviar pregunta" className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50"><Send size={17} /></button></form>
      {showReport ? <button type="button" onClick={() => setShowReport(false)} className="mx-3 mb-3 min-h-10 rounded-xl border border-blue-200 px-3 text-sm font-semibold text-blue-800 hover:bg-blue-50">Reportar un problema</button> : null}
      {!showReport && messages.some((message) => message.kind === "assistant") ? <button type="button" onClick={() => setShowReport(true)} className="mx-3 mb-3 min-h-10 self-start rounded-xl px-3 text-sm font-semibold text-blue-800 underline underline-offset-2">Reportar un problema</button> : null}
      {!showReport && (reportMessage || reportError) ? <p role={reportError ? "alert" : "status"} className={`mx-3 mb-3 rounded-lg p-3 text-sm ${reportError ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{reportError || reportMessage}</p> : null}
      {showReport ? <form onSubmit={(event) => void submitReport(event)} className="space-y-3 border-t border-slate-100 p-4">
        <h3 className="text-sm font-bold text-slate-900">Reportar un problema</h3><p className="text-xs leading-5 text-slate-600">Describe qué ocurrió y en qué página. No incluyas contraseñas, PIN, tokens, cookies, nombres, correos ni otros datos personales.</p>
        <label className="block text-xs font-semibold text-slate-700">Página<select value={page} onChange={(event) => setPage(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">{pages.map(([path, label]) => <option key={path} value={path}>{label} ({path})</option>)}</select></label>
        <label className="block text-xs font-semibold text-slate-700">Descripción<textarea required minLength={10} maxLength={1200} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full resize-y rounded-lg border border-slate-300 p-3 text-sm" placeholder="¿Qué pasó? ¿Qué esperabas que ocurriera?" /></label>
        <label aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">Sitio web<input tabIndex={-1} autoComplete="off" name="website" value="" readOnly /></label>
        {reportError || reportMessage ? <p role={reportError ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${reportError ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{reportError || reportMessage}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowReport(false)} className="min-h-10 rounded-lg px-3 text-sm text-slate-600">Cancelar</button><button type="submit" disabled={sending} className="min-h-10 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{sending ? "Enviando…" : "Enviar reporte"}</button></div>
      </form> : null}
    </section> : null}
  </>;
}
