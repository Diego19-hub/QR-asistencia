import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/** Parse the server-only 256-bit key represented as 64 hexadecimal characters. */
export function parseEmployeeQrEncryptionKey(value: string | undefined): Buffer {
  if (!value || !/^[\da-fA-F]{64}$/.test(value)) {
    throw new Error("QR credential encryption is unavailable.");
  }
  return Buffer.from(value, "hex");
}

function context(companyId: string, employeeId: string): Buffer {
  if (!companyId || !employeeId) throw new Error("Invalid QR credential context.");
  return Buffer.from(`${companyId}:${employeeId}`, "utf8");
}

export function encryptEmployeeQrToken(token: string, key: Buffer, companyId: string, employeeId: string): string {
  if (key.length !== 32 || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    throw new Error("Invalid QR credential encryption input.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(context(companyId, employeeId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptEmployeeQrToken(envelope: string, key: Buffer, companyId: string, employeeId: string): string {
  if (key.length !== 32) throw new Error("Invalid QR credential encryption key.");
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = envelope.split(".");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra !== undefined) {
    throw new Error("Invalid QR credential ciphertext.");
  }
  try {
    const iv = Buffer.from(encodedIv, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1 || ciphertext.length > 1024) {
      throw new Error("Invalid QR credential ciphertext.");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(context(companyId, employeeId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("QR credential could not be decrypted.");
  }
}

// Compatibility wrappers for the employee self-service flow. Both wrappers
// use the same canonical key parser, authenticated format, and tenant context.
export function encryptQrToken(token: string, companyId: string, employeeId: string): string {
  return encryptEmployeeQrToken(token, parseEmployeeQrEncryptionKey(process.env.QR_CREDENTIAL_ENCRYPTION_KEY), companyId, employeeId);
}

export function decryptQrToken(envelope: string, companyId: string, employeeId: string): string {
  return decryptEmployeeQrToken(envelope, parseEmployeeQrEncryptionKey(process.env.QR_CREDENTIAL_ENCRYPTION_KEY), companyId, employeeId);
}
