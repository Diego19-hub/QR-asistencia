import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../src/components/employees/employee-credentials.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/employees/[id]/qr/route.ts", import.meta.url), "utf8");
const portal = await readFile(new URL("../src/app/api/employee/portal/route.ts", import.meta.url), "utf8");
const employeePortal = await readFile(new URL("../src/components/employee/employee-portal.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261107220000_employee_self_service_qr_display.sql", import.meta.url), "utf8");

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

test("admin issuance persists only the hash and authenticated ciphertext while returning the token once", () => {
  const getHandler = route.match(/export async function GET\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(getHandler);
  assert.match(getHandler, /get_employee_credential_status/);
  assert.doesNotMatch(getHandler, /token\s*:/);
  assert.match(route, /createHash\("sha256"\)\.update\(rawToken/);
  assert.match(route, /p_token_hash_hex: tokenHash/);
  assert.match(route, /issue_employee_qr_token_with_ciphertext/);
  assert.match(route, /p_encrypted_token: encryptedToken/);
  assert.match(route, /credential: data, token: rawToken/);
  assert.match(route, /Cache-Control.*no-store, private/);
});

test("employee portal decrypts only the own-credential RPC result and never returns ciphertext", () => {
  assert.match(portal, /get_own_employee_credential_status/);
  assert.match(portal, /decryptEmployeeQrToken\(status\.encryptedToken, key, employee\.company_id, employee\.id\)/);
  assert.match(portal, /qrToken,/);
  assert.match(portal, /Cache-Control.*no-store, private/);
  assert.doesNotMatch(portal, /token_hash/i);
});

test("credential UI shows only an active QR and explains missing, revoked and legacy credentials", () => {
  assert.match(employeePortal, /QRCode\.toDataURL\(token/);
  assert.match(employeePortal, /item\.credential\.status === "active" && item\.credential\.qrToken/);
  assert.match(employeePortal, /Aún no tienes una credencial QR/);
  assert.match(employeePortal, /Esta credencial ya no está activa/);
  assert.match(employeePortal, /Pide a la administración que la regenere/);
  assert.match(employeePortal, /no registra asistencia ni solicita PIN/);
  assert.match(employeePortal, /Actualizar credencial/);
});

test("migration adds private encrypted storage and reuses existing issuance authorization atomically", () => {
  assert.match(migration, /alter table private\.employee_qr_tokens\s+add column encrypted_token text/i);
  assert.match(migration, /public\.issue_employee_qr_token\(p_company_id, p_employee_id, p_token_hash_hex, p_replace\)/);
  assert.match(migration, /set encrypted_token = p_encrypted_token/);
  assert.match(migration, /grant execute on function public\.issue_employee_qr_token_with_ciphertext[\s\S]*to authenticated/);
  assert.match(migration, /m\.active and m\.role = 'employee'/);
  assert.match(migration, /e\.auth_user_id = \(select auth\.uid\(\)\)/);
});
