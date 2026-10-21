"use client";

import { useState } from "react";
import { Copy, MessageCircle, Share2 } from "lucide-react";

import { copyTextToClipboard, createWhatsAppShareUrl, getPermanentAccessLinks } from "@/lib/access/access-links";

type AccessLinksSectionProps = { publicOrigin: string | null };

export function AccessLinksSection({ publicOrigin }: AccessLinksSectionProps) {
  const [feedback, setFeedback] = useState("");
  const links = publicOrigin ? getPermanentAccessLinks(publicOrigin) : null;

  async function copyLink(url: string, label: string) {
    setFeedback("");
    let copied = false;
    try {
      copied = await copyTextToClipboard(
        url,
        typeof navigator !== "undefined" ? navigator.clipboard ?? null : null,
        typeof document !== "undefined" ? document : null,
      );
    } catch {
      copied = false;
    }
    setFeedback(copied
      ? `Enlace de ${label} copiado.`
      : "No fue posible copiarlo automáticamente. Selecciona el enlace y cópialo manualmente.");
  }

  function shareLink(url: string, message: string) {
    setFeedback("");
    try {
      const shareWindow = window.open(createWhatsAppShareUrl(message, url), "_blank");
      if (!shareWindow) {
        setFeedback("No se pudo abrir WhatsApp. Copia el enlace y compártelo manualmente.");
        return;
      }
      shareWindow.opener = null;
    } catch {
      setFeedback("No se pudo abrir WhatsApp. Copia el enlace y compártelo manualmente.");
    }
  }

  return <section aria-labelledby="access-links-title" className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
    <div className="flex items-start gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-100 text-blue-700"><Share2 size={17} /></div>
      <div>
        <h3 id="access-links-title" className="text-sm font-semibold text-slate-900">Enlaces de acceso</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">Son enlaces permanentes. Compartirlos no concede permisos; cada persona debe iniciar sesión con una cuenta autorizada.</p>
      </div>
    </div>

    {feedback ? <p role="status" className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-slate-700">{feedback}</p> : null}
    {!links ? <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">No se pudo determinar el dominio público del sitio. Verifica APP_BASE_URL.</p> : (
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <AccessLinkCard
          title="Acceso para supervisores"
          description="Requiere una cuenta de supervisor activa y un dispositivo autorizado para registrar asistencia."
          url={links.supervisor}
          onCopy={() => void copyLink(links.supervisor, "supervisores")}
          onShare={() => shareLink(links.supervisor, "Acceso para supervisores de QR-asistencia")}
        />
        <AccessLinkCard
          title="Acceso para empleados"
          description="Requiere una cuenta activa con rol de empleado y un expediente vinculado para usar el portal personal."
          url={links.employee}
          onCopy={() => void copyLink(links.employee, "empleados")}
          onShare={() => shareLink(links.employee, "Acceso para empleados de QR-asistencia")}
        />
      </div>
    )}
  </section>;
}

function AccessLinkCard({ title, description, url, onCopy, onShare }: {
  title: string;
  description: string;
  url: string;
  onCopy: () => void;
  onShare: () => void;
}) {
  return <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
    <h4 className="text-xs font-semibold text-slate-900">{title}</h4>
    <p className="mt-1 min-h-10 text-[11px] leading-5 text-slate-500">{description}</p>
    <label className="mt-3 block text-[10px] font-semibold text-slate-600">
      Enlace permanente
      <input
        type="url"
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        aria-label={`Enlace permanente: ${title}`}
        className="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-normal text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </label>
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <button type="button" onClick={onCopy} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
        <Copy size={14} />Copiar enlace
      </button>
      <button type="button" onClick={onShare} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-3 text-xs font-semibold text-white transition hover:bg-[#1fbd5b] focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2">
        <MessageCircle size={15} />Compartir por WhatsApp
      </button>
    </div>
  </article>;
}
