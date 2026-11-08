import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptEmployeeQrToken,
  encryptEmployeeQrToken,
  parseEmployeeQrEncryptionKey,
} from "../src/lib/employees/qr-token-encryption.ts";

const key = parseEmployeeQrEncryptionKey("a".repeat(64));
const token = "synthetic-employee-qr-credential-token-1234567890";
const companyId = "company-a";
const employeeId = "employee-a";

test("employee QR encryption round-trips without storing plaintext", () => {
  const envelope = encryptEmployeeQrToken(token, key, companyId, employeeId);
  assert.match(envelope, /^v1\./);
  assert.equal(envelope.includes(token), false);
  assert.equal(decryptEmployeeQrToken(envelope, key, companyId, employeeId), token);
});

test("QR ciphertext is bound to its company and employee", () => {
  const envelope = encryptEmployeeQrToken(token, key, companyId, employeeId);
  assert.throws(() => decryptEmployeeQrToken(envelope, key, "company-b", employeeId));
  assert.throws(() => decryptEmployeeQrToken(envelope, key, companyId, "employee-b"));
});

test("tampered or malformed ciphertext is rejected", () => {
  const envelope = encryptEmployeeQrToken(token, key, companyId, employeeId);
  const [version, iv, tag, ciphertext] = envelope.split(".");
  const bytes = Buffer.from(ciphertext, "base64url");
  bytes[0] ^= 1;
  const changed = `${version}.${iv}.${tag}.${bytes.toString("base64url")}`;
  assert.throws(() => decryptEmployeeQrToken(changed, key, companyId, employeeId));
  assert.throws(() => decryptEmployeeQrToken("invalid", key, companyId, employeeId));
});

test("encryption key configuration must be exactly 32 bytes in hex", () => {
  assert.throws(() => parseEmployeeQrEncryptionKey(undefined));
  assert.throws(() => parseEmployeeQrEncryptionKey("not-a-key"));
  assert.equal(parseEmployeeQrEncryptionKey("b".repeat(64)).length, 32);
});
