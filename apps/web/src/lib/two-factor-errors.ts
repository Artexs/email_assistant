import type { TextKey } from "../i18n";

export interface CodeStepError {
  key: TextKey;
  // True when the user must go back to the password step.
  restart: boolean;
}

// Maps a Better Auth two-factor verify error to the text that shows it and the "start again" choice.
export function codeStepError(error: { status?: number; code?: string } | null | undefined): CodeStepError | null {
  if (error === null || error === undefined) return null;
  if (error.code === "ACCOUNT_TEMPORARILY_LOCKED") return { key: "tf_error_locked", restart: true };
  if (error.status === 429) return { key: "error_too_many", restart: false };
  if (error.code === "INVALID_CODE") return { key: "tf_error_code", restart: false };
  if (error.code === "INVALID_BACKUP_CODE") return { key: "tf_error_backup_code", restart: false };
  if (error.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") return { key: "tf_error_attempts", restart: true };
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") return { key: "tf_error_expired", restart: true };
  if (error.code === "TOTP_NOT_ENABLED") return { key: "tf_error_state", restart: false };
  return { key: "error_generic", restart: false };
}

// Spaces removed; exactly 6 digits give the digits, anything else gives null.
export function cleanTotpCode(input: string): string | null {
  const code = input.replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

// A backup code is trimmed only (it is case-sensitive). The dash may be left out.
export function cleanBackupCode(input: string): string | null {
  const trimmed = input.trim();
  const code = /^[A-Za-z0-9]{10}$/.test(trimmed) ? `${trimmed.slice(0, 5)}-${trimmed.slice(5)}` : trimmed;
  return /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/.test(code) ? code : null;
}
