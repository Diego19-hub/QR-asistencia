export const INVITATION_PASSWORD_MIN_LENGTH = 6;
export const INVITATION_PASSWORD_MAX_LENGTH = 128;

export function isValidInvitationPassword(password: unknown, confirmation: unknown): password is string {
  return typeof password === "string"
    && typeof confirmation === "string"
    && password.length >= INVITATION_PASSWORD_MIN_LENGTH
    && password.length <= INVITATION_PASSWORD_MAX_LENGTH
    && password === confirmation;
}
