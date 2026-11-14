import type { TextKey } from "../i18n";
import { ApiError } from "./api";

const codeTexts: Record<string, TextKey> = {
  mail_login_failed: "err_mail_login_failed",
  mail_unreachable: "err_mail_unreachable",
  mailbox_exists: "err_mailbox_exists",
  host_not_allowed: "err_host_not_allowed",
  wrong_status: "err_wrong_status",
  owner_only: "owner_only",
  telegram_off: "tg_off",
  telegram_unreachable: "tg_unreachable",
  telegram_consent_outdated: "tg_consent_outdated",
  rule_exists: "err_rule_exists",
  rule_limit: "err_rule_limit",
  not_found: "err_not_found",
  org_suspended: "err_org_suspended",
  mailbox_limit: "err_mailbox_limit",
};

export function errorText(error: unknown): TextKey {
  if (!(error instanceof ApiError)) return "error_generic";
  return (Object.hasOwn(codeTexts, error.code) ? codeTexts[error.code] : undefined) ?? "error_generic";
}

export interface DeleteError {
  // The field that shows the text; null means the text stands for the whole form.
  field: "password" | "name" | null;
  key: TextKey;
}

// DELETE /api/organization (F106 stage 04). 400 `wrong_password`, 400 `wrong_name` and 429 `locked` have their own
// text. Any other server answer (a busy 503 `internal`, a closed flag `not_found`) proves that nothing was deleted:
// `del_failed`. An error without a server answer (a network error, an unreadable 200) does not prove it: the delete
// may have run, so the text says to reload and check (`del_failed_unknown`).
export function deleteError(error: unknown): DeleteError {
  if (!(error instanceof ApiError)) return { field: null, key: "del_failed_unknown" };
  if (error.code === "wrong_password") return { field: "password", key: "del_wrong_password" };
  if (error.code === "wrong_name") return { field: "name", key: "del_wrong_name" };
  if (error.code === "locked") return { field: "password", key: "del_locked" };
  return { field: null, key: "del_failed" };
}
