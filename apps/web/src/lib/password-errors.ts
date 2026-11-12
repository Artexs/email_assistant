import type { TextKey } from "../i18n/en";

export interface ChangePasswordError {
  field: "current" | "password" | null;
  key: TextKey;
}

// Maps a Better Auth `changePassword` error to the field and the text that show it.
export function changePasswordError(
  error: { status?: number; code?: string } | null | undefined
): ChangePasswordError | null {
  if (error === null || error === undefined) return null;
  if (error.status === 429) return { field: null, key: "error_too_many" };
  if (error.code === "INVALID_PASSWORD") return { field: "current", key: "acct_wrong_current" };
  if (error.code === "PASSWORD_TOO_SHORT") return { field: "password", key: "password_too_short" };
  if (error.code === "PASSWORD_TOO_LONG") return { field: "password", key: "password_too_long" };
  if (error.code === "PASSWORD_COMPROMISED") return { field: "password", key: "password_pwned" };
  if (error.status === 503 || error.code === "PASSWORD_CHECK_UNAVAILABLE") {
    return { field: null, key: "password_check_unavailable" };
  }
  return { field: null, key: "error_generic" };
}

// Maps a failed password-set request (`setPasswordWithTerms`) to a text, or to "invalid" when the link is dead.
export function setupError(status: number, code: string | null): "invalid" | TextKey {
  if (code === "INVALID_TOKEN") return "invalid";
  if (status === 429) return "error_too_many";
  if (code === "TERMS_REQUIRED") return "terms_required";
  if (code === "PASSWORD_COMPROMISED") return "password_pwned";
  if (status === 503 || code === "PASSWORD_CHECK_UNAVAILABLE") return "password_check_unavailable";
  return "error_generic";
}

export type SignOutAllResult = { done: true } | { done: false; key: TextKey };

// Decides what follows `revokeSessions`: a 401 means the session is already gone, so the user may go to login.
export function signOutAllResult(error: { status?: number } | null | undefined): SignOutAllResult {
  if (error === null || error === undefined || error.status === 401) return { done: true };
  return { done: false, key: error.status === 429 ? "error_too_many" : "error_generic" };
}
