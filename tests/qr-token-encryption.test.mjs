import assert from "node:assert/strict";
import test from "node:test";
import { decryptQrToken, encryptQrToken } from "../src/lib/employees/qr-token-encryption.ts";

const original = process.env.QR_CREDENTIAL_ENCRYPTION_KEY;
const syntheticKey = Buffer.alloc(32, 7).toString("base64url");
const companyA = "d1000000-0000-4000-8000-000000000001";
const employeeA = "d2000000-0000-4000-8000-000000000001";

test("QR tokens encrypt and decrypt with an authenticated AES-256-GCM envelope", () => {
  process.env.QR_CREDENTIAL_ENCRYPTION_KEY = syntheticKey;
  const token = "synthetic-employee-credential-token-12345678901234567890";
  const encrypted = encryptQrToken(token, companyA, employeeA);
  assert.match(encrypted, /^v1\./);
  assert.notEqual(encrypted.includes(token), true);
  assert.equal(decryptQrToken(encrypted, companyA, employeeA), token);
  assert.throws(() => decryptQrToken(encrypted, "d1000000-0000-4000-8000-000000000002", employeeA), /could not be decrypted/);
  assert.throws(() => decryptQrToken(encrypted, companyA, "d2000000-0000-4000-8000-000000000002"), /could not be decrypted/);
  assert.throws(() => decryptQrToken(`${encrypted.slice(0, -1)}x`, companyA, employeeA));
});

test("QR encryption fails closed when the server key is absent or has the wrong size", () => {
  delete process.env.QR_CREDENTIAL_ENCRYPTION_KEY;
  assert.throws(() => encryptQrToken("synthetic-employee-credential-token-12345678901234567890", companyA, employeeA), /QR_CREDENTIAL_ENCRYPTION_KEY is not configured/);
  process.env.QR_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64url");
  assert.throws(() => decryptQrToken("v1.a.b.c", companyA, employeeA), /could not be decrypted/);
  process.env.QR_CREDENTIAL_ENCRYPTION_KEY = "!".repeat(43);
  assert.throws(() => encryptQrToken("synthetic-employee-credential-token-12345678901234567890", companyA, employeeA), /base64url for exactly 32 bytes/);
});

test.after(() => {
  if (original === undefined) delete process.env.QR_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.QR_CREDENTIAL_ENCRYPTION_KEY = original;
});
