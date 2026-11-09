"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { usePathname } from "next/navigation";
import { BotMessageSquare, CircleHelp, Maximize2, Minus, Send, X } from "lucide-react";

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
  const [activePanel, setActivePanel] = useState<"chat" | "report" | null>(null);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [description, setDescription] = useState("");
  const [page, setPage] = useState("/admin");
  const [sending, setSending] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [reportError, setReportError] = useState("");
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const reportButtonRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<"chat" | "report" | null>(null);
  const panelWasOpen = useRef(false);

  useEffect(() => {
    if (activePanel === "chat") {
      document.getElementById(chatMinimized ? "chat-minimize-toggle" : "help-question")?.focus();
      panelWasOpen.current = true;
    } else if (activePanel === "report") {
      document.getElementById("help-report-description")?.focus();
      panelWasOpen.current = true;
    } else if (panelWasOpen.current) {
      (lastTriggerRef.current === "report" ? reportButtonRef : helpButtonRef).current?.focus();
      panelWasOpen.current = false;
    }
  }, [activePanel, chatMinimized]);

  useEffect(() => {
    if (!activePanel) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setActivePanel(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = question.trim();
    if (!value || asking) return;
    setMessages((items) => [...items, { kind: "user", text: value }]);
    setQuestion(""); setAsking(true);
    try {
      const response = await fetch("/api/help/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: value }), cache: "no-store" });
      const body = await response.json() as { answer?: string; found?: boolean; error?: string };
      if (!response.ok || !body.answer) throw new Error(body.error ?? "La ayuda no está disponible en este momento.");
      setMessages((items) => [...items, { kind: "assistant", text: body.answer!, found: body.found }]);
    } catch (reason) {
      setMessages((items) => [...items, { kind: "assistant", text: reason instanceof Error ? reason.message : "La ayuda no está disponible en este momento." }]);
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

  function openPanel(panel: "chat" | "report") {
    lastTriggerRef.current = panel;
    if (panel === "report") setPage(currentPage(pathname));
    if (panel === "chat" && activePanel === "chat" && chatMinimized) {
      setChatMinimized(false);
      return;
    }
    if (panel !== "chat") setChatMinimized(false);
    setActivePanel((current) => current === panel ? null : panel);
  }

  const triggerPosition = employeePortal ? "bottom-24 md:bottom-6" : "bottom-4 sm:bottom-6";
  const panelPosition = employeePortal
    ? "bottom-[11rem] max-h-[min(66dvh,calc(100dvh-12rem))] md:bottom-36 md:max-h-[min(76dvh,680px)]"
    : "bottom-[8.5rem] max-h-[min(76dvh,calc(100dvh-11rem))] sm:bottom-36 sm:max-h-[min(76dvh,680px)]";
  const minimizedPosition = employeePortal ? "bottom-[11rem] md:bottom-36" : "bottom-[8.5rem] sm:bottom-36";

  return <>
    <div className={`fixed ${triggerPosition} right-4 z-[60] flex flex-col items-end gap-2 sm:right-6`}>
      <button ref={helpButtonRef} type="button" aria-haspopup="dialog" aria-controls="help-dialog" aria-expanded={activePanel === "chat" && !chatMinimized} onClick={() => openPanel("chat")} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-blue-700 px-5 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 active:scale-[.98]">
        <CircleHelp size={19} aria-hidden="true" />Ayuda
      </button>
      <button ref={reportButtonRef} type="button" aria-haspopup="dialog" aria-controls="report-dialog" aria-expanded={activePanel === "report"} onClick={() => openPanel("report")} className="inline-flex min-h-12 items-center gap-2 rounded-full border border-blue-200 bg-white px-5 text-sm font-semibold text-blue-800 shadow-lg transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 active:scale-[.98]">
        Reportar un problema
      </button>
    </div>

    {activePanel === "chat" ? <section id="help-dialog" role="dialog" aria-modal="false" aria-labelledby="help-assistant-title" className={`fixed inset-x-3 ${chatMinimized ? minimizedPosition : panelPosition} z-[60] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${chatMinimized ? "h-auto" : ""} sm:inset-x-auto sm:right-6 sm:w-[min(460px,calc(100vw-2rem))]`}>
      <header className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-blue-50 via-white to-white px-4 py-3"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-100 text-blue-800"><BotMessageSquare size={20} aria-hidden="true" /></span><h2 id="help-assistant-title" className="text-base font-bold text-slate-950">Chatbot</h2></div><div className="flex items-center gap-1"><button id="chat-minimize-toggle" type="button" onClick={() => setChatMinimized((value) => !value)} aria-label={chatMinimized ? "Restaurar Chatbot" : "Minimizar Chatbot"} className="grid size-10 place-items-center rounded-lg text-slate-600 transition hover:bg-blue-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 active:bg-blue-200"><span className="sr-only">{chatMinimized ? "Restaurar" : "Minimizar"}</span>{chatMinimized ? <Maximize2 size={18} aria-hidden="true" /> : <Minus size={18} aria-hidden="true" />}</button><button type="button" onClick={() => { setChatMinimized(false); setActivePanel(null); }} aria-label="Cerrar Chatbot" className="grid size-10 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-200 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 active:bg-slate-300"><X size={18} aria-hidden="true" /></button></div></header>
      {!chatMinimized ? <>
        <div aria-live="polite" aria-relevant="additions text" className="min-h-36 flex-1 space-y-4 overflow-y-auto bg-slate-50/70 p-4 sm:p-5">
          {!messages.length ? <p className="rounded-2xl border border-blue-100 bg-white p-4 text-base leading-7 text-slate-700 shadow-sm">Hola. Pregúntame cómo iniciar sesión, elegir una empresa, administrar horarios, usar el escáner o consultar tu credencial. Responderé con pasos que aparecen en el manual de usuario.</p> : null}
          {messages.map((message, index) => <article key={`${message.kind}-${index}`} className={`max-w-[92%] rounded-2xl p-4 text-base leading-7 shadow-sm ${message.kind === "user" ? "ml-auto bg-blue-700 text-white" : "mr-auto border border-slate-200 bg-white text-slate-800"}`}><p className={`mb-1 text-sm font-bold ${message.kind === "user" ? "text-blue-100" : "text-blue-800"}`}>{message.kind === "user" ? "Tú" : "Chatbot"}</p><p className="whitespace-pre-wrap">{message.text}</p>{message.kind === "assistant" && message.found ? <p className="mt-3 border-t border-slate-100 pt-2 text-sm font-medium text-slate-600">Información del manual de usuario</p> : null}</article>)}
          {asking ? <p role="status" className="text-base text-slate-600">Buscando en el manual…</p> : null}
        </div>
        <form onSubmit={(event) => void ask(event)} className="border-t border-slate-200 bg-white p-3 sm:p-4"><div className="flex gap-2"><label htmlFor="help-question" className="sr-only">Pregunta</label><input id="help-question" value={question} maxLength={300} onChange={(event) => setQuestion(event.target.value)} placeholder="Escribe tu pregunta" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-base outline-none placeholder:text-slate-500 focus:border-blue-700 focus:ring-2 focus:ring-blue-100" /><button type="submit" disabled={asking || !question.trim()} aria-label="Enviar pregunta" className="grid size-12 shrink-0 place-items-center rounded-xl bg-blue-700 text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 active:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"><Send size={18} aria-hidden="true" /></button></div><p className="mt-2 text-sm leading-5 text-slate-600">Privacidad: no incluyas nombres ni datos de empresa o trabajador, correos, RFC, NSS, contraseñas, PIN o tokens. Si Gemini está habilitado, se envía la pregunta redactada y solo los fragmentos pertinentes del manual. El nivel gratuito de Gemini puede usar el contenido enviado para mejorar sus productos según sus condiciones vigentes. Si prefieres, no compartas información sensible.</p></form>
      </> : null}
    </section> : null}

    {activePanel === "report" ? <section id="report-dialog" role="dialog" aria-modal="false" aria-labelledby="report-dialog-title" className={`fixed inset-x-3 ${panelPosition} z-[60] flex flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[min(420px,calc(100vw-2rem))]`}>
      <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3"><div><h2 id="report-dialog-title" className="text-sm font-bold text-slate-900">Reportar un problema</h2><p className="text-xs text-slate-500">Describe el error y la página</p></div><button type="button" onClick={() => setActivePanel(null)} aria-label="Cerrar formulario de reporte" className="grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><X size={18} /></button></header>
      <form onSubmit={(event) => void submitReport(event)} className="space-y-3 p-4">
        <p className="text-sm leading-5 text-slate-600">Describe qué ocurrió y en qué página. No incluyas contraseñas, PIN, tokens, cookies, nombres, correos ni otros datos personales.</p>
        <label className="block text-sm font-semibold text-slate-700">Página<select value={page} onChange={(event) => setPage(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base font-normal"><option value={page}>Página actual ({page})</option>{pages.filter(([path]) => path !== page).map(([path, label]) => <option key={path} value={path}>{label} ({path})</option>)}</select></label>
        <label htmlFor="help-report-description" className="block text-sm font-semibold text-slate-700">Descripción<textarea id="help-report-description" required minLength={10} maxLength={1200} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full resize-y rounded-lg border border-slate-300 p-3 text-base font-normal" placeholder="¿Qué pasó? ¿Qué esperabas que ocurriera?" /></label>
        <label aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">Sitio web<input tabIndex={-1} autoComplete="off" name="website" value="" readOnly /></label>
        {reportError || reportMessage ? <p role={reportError ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${reportError ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{reportError || reportMessage}</p> : null}
        <div className="flex justify-end"><button type="submit" disabled={sending} className="min-h-11 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition hover:bg-blue-800 active:bg-blue-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:cursor-wait disabled:opacity-50">{sending ? "Enviando…" : "Enviar reporte"}</button></div>
      </form>
    </section> : null}
  </>;
}
