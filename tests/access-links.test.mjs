import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  accessReturnDestination,
  copyTextToClipboard,
  createWhatsAppShareUrl,
  destinationForAccessRole,
  getPermanentAccessLinks,
} from "../src/lib/access/access-links.ts";

test("permanent access URLs use only the configured public origin and fixed paths", () => {
  const links = getPermanentAccessLinks("https://attendance.example.com/config?company=private#tab");
  assert.deepEqual(links, {
    supervisor: "https://attendance.example.com/scanner",
    employee: "https://attendance.example.com/mi-qr",
  });
  assert.throws(() => getPermanentAccessLinks("https://user:secret@attendance.example.com"));
  assert.throws(() => getPermanentAccessLinks("javascript:alert(1)"));
});

test("WhatsApp sharing encodes the text and has no recipient number", () => {
  const url = new URL(createWhatsAppShareUrl("Acceso para empleados", "https://attendance.example.com/mi-qr"));
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("text"), "Acceso para empleados\nhttps://attendance.example.com/mi-qr");
});

test("login return destinations are a closed set and must match the membership role", () => {
  assert.equal(accessReturnDestination("/scanner"), "/scanner");
  assert.equal(accessReturnDestination("/mi-qr"), "/mi-qr");
  for (const unsafe of ["//attacker.example", "https://attacker.example", "/scanner?companyId=secret", "/admin", "\\\\attacker.example"]) {
    assert.equal(accessReturnDestination(unsafe), null);
  }
  assert.equal(destinationForAccessRole("supervisor", "/scanner"), "/scanner");
  assert.equal(destinationForAccessRole("employee", "/scanner"), "/mi-qr");
  assert.equal(destinationForAccessRole("employee", "/mi-qr"), "/mi-qr");
  assert.equal(destinationForAccessRole("admin", "/scanner"), "/admin");
});

test("copy uses the Clipboard API and falls back to the browser copy command", async () => {
  let clipboardText = "";
  assert.equal(await copyTextToClipboard("https://attendance.example.com/scanner", {
    writeText: async (text) => { clipboardText = text; },
  }, null), true);
  assert.equal(clipboardText, "https://attendance.example.com/scanner");

  let copiedText = "";
  let removed = false;
  const textarea = {
    value: "",
    style: {},
    setAttribute() {},
    select() { copiedText = this.value; },
    remove() { removed = true; },
  };
  const documentPort = {
    createElement: () => textarea,
    body: { appendChild() {} },
    execCommand: (command) => command === "copy",
  };
  assert.equal(await copyTextToClipboard("https://attendance.example.com/mi-qr", null, documentPort), true);
  assert.equal(copiedText, "https://attendance.example.com/mi-qr");
  assert.equal(removed, true);
  assert.equal(await copyTextToClipboard("link", null, null), false);
});

test("access routes retain server-side role, active membership, employee linkage, and scanner device checks", async () => {
  const [scanner, employeeLayout, employeeApi, scannerApi, selectionAction, settingsPage, loginAction] = await Promise.all([
    readFile(new URL("../src/app/(supervisor)/scanner/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(employee)/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/employee/portal/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/supervisor/scanner/context/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(auth)/seleccionar-empresa/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(admin)/admin/configuracion/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(auth)/login/actions.ts", import.meta.url), "utf8"),
  ]);

  assert.match(scanner, /auth\.getUser\(\)/);
  assert.match(scanner, /\.eq\("active", true\)/);
  assert.match(scanner, /membership\.role === "supervisor"/);
  assert.match(employeeLayout, /auth\.getUser\(\)/);
  assert.match(employeeLayout, /\.eq\("active", true\)/);
  assert.match(employeeLayout, /membership\.role === "employee"/);
  assert.match(employeeApi, /isOwnActiveEmployee/);
  assert.match(employeeApi, /employee_role_required/);
  assert.match(employeeApi, /employee_profile_unlinked/);
  assert.match(scannerApi, /get_supervisor_scanner_context/);
  assert.match(scannerApi, /p_device_token: deviceToken/);
  assert.match(selectionAction, /\.eq\("user_id", auth\.user\.id\)\.eq\("active", true\)/);
  assert.match(settingsPage, /getAuthRedirectUrl\("confirm"\)\?\.origin/);
  assert.ok(loginAction.indexOf("pending.length") < loginAction.indexOf("const choices"), "pending invitations keep precedence over access-link return routing");
});

test("access link controls remain usable in a narrow mobile layout", async () => {
  const component = await readFile(new URL("../src/components/admin/access-links-section.tsx", import.meta.url), "utf8");
  assert.match(component, /grid-cols-1 gap-2 sm:grid-cols-2/);
  assert.match(component, /min-w-0/);
  assert.match(component, /onFocus=\{\(event\) => event\.currentTarget\.select\(\)\}/);
  assert.match(component, /Compartir por WhatsApp/);
});
