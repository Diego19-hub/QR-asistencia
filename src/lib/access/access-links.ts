export type AccessReturnDestination = "/scanner" | "/mi-qr";
export type AccessRole = "owner" | "admin" | "supervisor" | "employee";

export function getPermanentAccessLinks(appOrigin: string) {
  const parsed = new URL(appOrigin);
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("El origen público configurado no es válido.");
  }

  return {
    supervisor: new URL("/scanner", parsed.origin).href,
    employee: new URL("/mi-qr", parsed.origin).href,
  };
}

export function createWhatsAppShareUrl(message: string, accessUrl: string) {
  const shareUrl = new URL("https://wa.me/");
  shareUrl.searchParams.set("text", `${message}\n${accessUrl}`);
  return shareUrl.href;
}

export function accessReturnDestination(value: unknown): AccessReturnDestination | null {
  return value === "/scanner" || value === "/mi-qr" ? value : null;
}

export function destinationForAccessRole(role: AccessRole, requested?: AccessReturnDestination | null) {
  if (requested === "/scanner" && role === "supervisor") return requested;
  if (requested === "/mi-qr" && role === "employee") return requested;
  if (role === "owner" || role === "admin") return "/admin";
  return role === "supervisor" ? "/scanner" : "/mi-qr";
}

export function loginPathForAccessDestination(destination?: AccessReturnDestination | null) {
  return destination ? `/login?next=${encodeURIComponent(destination)}` : "/login";
}

export function companySelectionPathForAccessDestination(destination?: AccessReturnDestination | null) {
  return destination ? `/seleccionar-empresa?next=${encodeURIComponent(destination)}` : "/seleccionar-empresa";
}

export async function copyTextToClipboard(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | null,
  documentRef: Document | null,
) {
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Try the legacy browser copy command below when clipboard permission is denied.
    }
  }

  if (!documentRef || typeof documentRef.execCommand !== "function") return false;

  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = documentRef.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    documentRef.body.appendChild(textarea);
    textarea.select();
    return documentRef.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea?.remove();
  }
}
