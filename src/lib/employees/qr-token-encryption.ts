import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey() {
  const encoded = process.env.QR_CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) throw new Error("QR_CREDENTIAL_ENCRYPTION_KEY is not configured");
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
    throw new Error("QR_CREDENTIAL_ENCRYPTION_KEY must be base64url for exactly 32 bytes");
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded) {
    throw new Error("QR_CREDENTIAL_ENCRYPTION_KEY must be base64url for exactly 32 bytes");
  }
  return key;
}

function credentialContext(companyId: string, employeeId: string) {
  if (!companyId || !employeeId) throw new Error("QR credential context is incomplete");
  return Buffer.from(`${companyId}:${employeeId}`, "utf8");
}

export function encryptQrToken(token: string, companyId: string, employeeId: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new Error("QR credential token is invalid");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(credentialContext(companyId, employeeId));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `${VERSION}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptQrToken(value: string, companyId: string, employeeId: string) {
  const [version, ivText, tagText, ciphertextText, extra] = value.split(".");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error("Stored QR credential has an unsupported format");
  }
  try {
    const iv = Buffer.from(ivText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    const ciphertext = Buffer.from(ciphertextText, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1 || ciphertext.length > 1024) {
      throw new Error("Invalid QR credential envelope");
    }
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAAD(credentialContext(companyId, employeeId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("QR credential could not be decrypted");
  }
}
