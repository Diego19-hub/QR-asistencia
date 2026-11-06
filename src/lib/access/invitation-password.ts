export const INVITATION_PASSWORD_MIN_LENGTH = 6;
export const INVITATION_PASSWORD_MAX_LENGTH = 128;
export const INVITATION_FULL_NAME_MIN_LENGTH = 2;
export const INVITATION_FULL_NAME_MAX_LENGTH = 120;

export function normalizeInvitationFullName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const name = value.trim().replace(/\s+/gu, " ");
  if (name.length < INVITATION_FULL_NAME_MIN_LENGTH || name.length > INVITATION_FULL_NAME_MAX_LENGTH) return null;
  if (!/\p{L}/u.test(name)) return null;
  return name;
}

export function isValidInvitationPassword(password: unknown, confirmation: unknown): password is string {
  return typeof password === "string"
    && typeof confirmation === "string"
    && password.length >= INVITATION_PASSWORD_MIN_LENGTH
    && password.length <= INVITATION_PASSWORD_MAX_LENGTH
    && password === confirmation;
}

/** The timestamp is written only by the trusted Auth Admin Server Action. */
export function hasCompletedInvitationAccountSetup(value: unknown, now = Date.now()): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now;
}
