import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../src/components/employees/employee-credentials.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/employees/[id]/qr/route.ts", import.meta.url), "utf8");
const employeeRoute = await readFile(new URL("../src/app/api/employee/credential/route.ts", import.meta.url), "utf8");

test("emission confirms that regenerating invalidates the prior QR", () => {
  assert.match(component, /El código anterior dejará de funcionar inmediatamente/);
});

test("issued QR is rendered as an employee credential with all delivery actions", () => {
  assert.match(component, /makeCredentialCard\(image, employee, company\.companyName\)/);
  assert.match(component, /Descargar PNG/);
  assert.match(component, /Descargar PDF/);
  assert.match(component, /Imprimir/);
  assert.match(component, /employee\.employee_number/);
});

test("closing or revoking clears the in-memory QR and credential image", () => {
  assert.match(component, /function closeQr\(\) \{ setQrDataUrl\(""\); setCredentialCardUrl\(""\); \}/);
  assert.match(component, /setQrDataUrl\(""\); setCredentialCardUrl\(""\); setNotice\("QR revocado/);
});

test("status lookup never returns a recoverable QR token", () => {
  const getHandler = route.match(/export async function GET\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(getHandler);
  assert.match(getHandler, /get_employee_credential_status/);
  assert.doesNotMatch(getHandler, /token\s*:/);
  assert.match(route, /createHash\("sha256"\)\.update\(rawToken/);
  assert.match(route, /encryptQrToken\(rawToken,\s*result\.scope\.company\.companyId,\s*id\)/);
  assert.match(route, /p_token_hash_hex: tokenHash/);
  assert.match(route, /p_encrypted_token: encryptedToken/);
  assert.match(route, /credential: data, token: rawToken/);
  assert.match(route, /Cache-Control.*no-store, private/);
});

test("employee credential recovery is self-only, active-only, encrypted-at-rest and non-cacheable", () => {
  assert.match(employeeRoute, /eq\("auth_user_id", auth\.user\.id\)/);
  assert.match(employeeRoute, /get_own_employee_qr_credential/);
  assert.match(employeeRoute, /decryptQrToken\(credential\.encryptedToken,\s*employee\.company_id,\s*employee\.id\)/);
  assert.match(employeeRoute, /Cache-Control.*no-store, private/);
  assert.doesNotMatch(employeeRoute, /console\.(?:log|error|warn)/);
});
