import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../src/components/employees/employee-credentials.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/employees/[id]/qr/route.ts", import.meta.url), "utf8");
const credentialRoute = await readFile(new URL("../src/app/api/employee/credential/route.ts", import.meta.url), "utf8");
const portal = await readFile(new URL("../src/app/api/employee/portal/route.ts", import.meta.url), "utf8");
const employeePortal = await readFile(new URL("../src/components/employee/employee-portal.tsx", import.meta.url), "utf8");
const issuanceMigration = await readFile(new URL("../supabase/migrations/20261107220000_employee_self_service_qr_display.sql", import.meta.url), "utf8");
const revocationMigration = await readFile(new URL("../supabase/migrations/20261107230000_optional_attendance_pin_and_recoverable_qr.sql", import.meta.url), "utf8");

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

test("admin issuance stores only a digest and authenticated ciphertext, returning the token once", () => {
  const getHandler = route.match(/export async function GET\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(getHandler);
  assert.match(getHandler, /get_employee_credential_status/);
  assert.doesNotMatch(getHandler, /token\s*:/);
  assert.match(route, /createHash\("sha256"\)\.update\(rawToken/);
  assert.match(route, /issue_employee_qr_token_with_ciphertext/);
  assert.match(route, /p_token_hash_hex: tokenHash/);
  assert.match(route, /p_encrypted_token: encryptedToken/);
  assert.match(route, /credential: data, token: rawToken/);
  assert.match(route, /Cache-Control.*no-store, private/);
});

test("employee credential endpoint is self-only, decrypts the canonical RPC result, and is non-cacheable", () => {
  assert.match(credentialRoute, /eq\("auth_user_id", auth\.user\.id\)/);
  assert.match(credentialRoute, /eq\("active", true\)/);
  assert.match(credentialRoute, /get_own_employee_credential_status/);
  assert.match(credentialRoute, /decryptEmployeeQrToken\(credential\.encryptedToken, key, employee\.company_id, employee\.id\)/);
  assert.match(credentialRoute, /Cache-Control.*no-store, private/);
  assert.doesNotMatch(credentialRoute, /console\.(?:log|error|warn)/);
});

test("portal overview returns status only; QR material is fetched on demand from the self-scoped endpoint", () => {
  assert.match(portal, /get_own_employee_credential_status/);
  assert.match(portal, /status: status\.status/);
  assert.doesNotMatch(portal, /decryptEmployeeQrToken|qrToken\s*,/);
  assert.match(employeePortal, /fetch\(`\/api\/employee\/credential\?employeeId=/);
  assert.match(employeePortal, /QRCode\.toDataURL\(body\.token/);
  assert.match(employeePortal, /Aún no tienes una credencial QR/);
  assert.match(employeePortal, /Esta credencial fue revocada/);
  assert.match(employeePortal, /se emitió antes de habilitar su recuperación segura/);
  assert.match(employeePortal, /Mostrar el QR no registra asistencia ni solicita un PIN/);
});

test("main QR migration owns ciphertext storage and issuance; later migration only clears it on revocation", () => {
  assert.match(issuanceMigration, /alter table private\.employee_qr_tokens\s+add column encrypted_token text/i);
  assert.match(issuanceMigration, /public\.issue_employee_qr_token\(p_company_id, p_employee_id, p_token_hash_hex, p_replace\)/);
  assert.match(issuanceMigration, /public\.get_own_employee_credential_status/);
  assert.match(issuanceMigration, /m\.active and m\.role = 'employee'/);
  assert.match(issuanceMigration, /e\.auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(revocationMigration, /revoked_at = clock_timestamp\(\), encrypted_token = null/);
  assert.doesNotMatch(revocationMigration, /create or replace function public\.(scan_employee_attendance|confirm_employee_attendance|get_own_employee_credential_status)/);
});
