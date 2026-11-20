import { MINUTE_MS } from "@ea/core";

import { MailAuthError, SmtpSendError, type AuthErrorReason } from "../mail";

import { authErrorOutcome } from "./apply-shared";
import { HARD_ERROR_TRIES, RETRY_WAIT_MS, SEND_SOFT_CAP_MS } from "./constants";

export const SEND_RETRY_WAIT_MS = RETRY_WAIT_MS;
export const SEND_HARD_TRIES = HARD_ERROR_TRIES;
// `provider_result.cap` of a send that the soft-retry cap ended; the result notice reads it.
export const SOFT_CAP_MARK = "soft_retry";
// The notifier treats an older `pending` Sent copy as failed.
export const SENT_COPY_PENDING_MAX_AGE_MS = 10 * MINUTE_MS;

export type SendOutcome =
  | { kind: "auth_error"; reason?: AuthErrorReason }
  | { kind: "retry"; soft: boolean; count: boolean }
  | { kind: "failed"; reason: "smtp_rejected" | "smtp_error" | "outcome_unknown"; capped?: true };

// Pure. Maps an error of `sender.send` to what the row does. No branch sends again.
// `sinceTapMs` is the time since the tap (`approved_at`): a soft error at or after the cap ends the send.
export function sendOutcomeOf(error: unknown, attempts: number, sinceTapMs = 0): SendOutcome {
  if (error instanceof MailAuthError) return authErrorOutcome(error);
  // Not a typed SMTP error: the system cannot tell where the call stopped, so the mail may have gone out.
  if (!(error instanceof SmtpSendError) || error.stage === "unknown") {
    return { kind: "failed", reason: "outcome_unknown" };
  }
  if (error.stage === "content") {
    return { kind: "failed", reason: error.permanent ? "smtp_rejected" : "smtp_error" };
  }
  if (error.stage === "envelope" && error.permanent) return { kind: "failed", reason: "smtp_rejected" };
  if (error.soft) {
    if (sinceTapMs >= SEND_SOFT_CAP_MS) return { kind: "failed", reason: "smtp_error", capped: true };
    return { kind: "retry", soft: true, count: false };
  }
  if (attempts + 1 >= SEND_HARD_TRIES) return { kind: "failed", reason: "smtp_error" };
  return { kind: "retry", soft: false, count: true };
}
