import type { TextKey } from "../i18n/en";
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
  rule_exists: "err_rule_exists",
  rule_limit: "err_rule_limit",
  not_found: "err_not_found",
};

export function errorText(error: unknown): TextKey {
  if (!(error instanceof ApiError)) return "error_generic";
  return (Object.hasOwn(codeTexts, error.code) ? codeTexts[error.code] : undefined) ?? "error_generic";
}
