"use client";

import { useEffect, useState } from "react";

const TOKEN_KEY = "qr-share-invitation-token";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function SharedInvitationAcceptance({ canAccept }: { canAccept: boolean }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    if (window.location.hash) {
      const token = new URLSearchParams(window.location.hash.slice(1)).get("t");
      if (token && TOKEN_PATTERN.test(token)) window.sessionStorage.setItem(TOKEN_KEY, token);
      else window.sessionStorage.removeItem(TOKEN_KEY);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    const timer = window.setTimeout(() => {
      const stored = window.sessionStorage.getItem(TOKEN_KEY);
      setHasToken(Boolean(stored && TOKEN_PATTERN.test(stored)));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function accept() {
    const token = window.sessionStorage.getItem(TOKEN_KEY);
    if (!token || !TOKEN_PATTERN.test(token)) {
      setHasToken(false);
      setError("No se encontró el código del enlace. Vuelve a abrir el enlace completo de WhatsApp.");
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/invitations/share/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      const result = await response.json() as { accepted?: boolean; next?: string; error?: { message?: string } };
      if (!response.ok || !result.accepted) {
        setError(result.error?.message ?? "La invitación no está disponible. Verifica que esté vigente y dirigida al correo confirmado de tu cuenta.");
        return;
      }
      window.sessionStorage.removeItem(TOKEN_KEY);
      const next = result.next === "/admin" || result.next === "/scanner" || result.next === "/mi-qr" || result.next === "/seleccionar-empresa" ? result.next : "/seleccionar-empresa";
      window.location.assign(next);
    } catch {
      setError("No fue posible contactar el servicio. Inténtalo de nuevo.");
    } finally { setBusy(false); }
  }

  return <div className="mt-6">
    {error ? <p role="alert" className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
    {canAccept ? <>
      <button type="button" onClick={() => void accept()} disabled={!ready || !hasToken || busy} className="h-11 w-full rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Validando invitación…" : "Aceptar invitación"}
      </button>
      {ready && !hasToken ? <p className="mt-2 text-xs text-amber-700">Abre el enlace completo para recuperar el código de invitación.</p> : null}
    </> : ready && hasToken ? <p className="text-xs text-slate-600">El enlace quedó disponible solo en esta pestaña. Inicia sesión y regresarás aquí para aceptar.</p> : null}
  </div>;
}
