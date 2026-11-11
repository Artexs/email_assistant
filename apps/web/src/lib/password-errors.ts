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
  return { field: null, key: "error_generic" };
}
