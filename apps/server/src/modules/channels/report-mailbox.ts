import type { ReportMailMessage } from "@ea/core";

import type { TenantContext } from "../../platform/db";

// F110 stage 20 (ADR 0022): the port that puts a report mail into the user's own mailbox. It is not a `ChatChannel`: a mail has no
// chat, no message id to edit and no buttons. The port APPENDs; it has no way to send. The recipient is the mailbox itself, fixed by
// `ReportMailMessage` (`to` holds the mailbox address from the mailbox row).
//
// - `unavailable`: the mailbox cannot take mail now (login refused, server not allowed, mailbox gone). The row waits.
// - `soft`: the network failed (timeout, lost connection). The row waits with a back-off and counts an attempt.
// - `other`: a failure that is not a network failure and not a refusal. Back-off; the row fails after a few of them.
// - `refused`: the server answered `NO` to the APPEND. The row fails at once (`append_refused`).
export type ReportMailErrorKind = "unavailable" | "soft" | "other" | "refused";

/** A report mail failure. `code` is log-safe: it never holds an address, a text or an inner error text. */
export class ReportMailError extends Error {
  constructor(
    readonly kind: ReportMailErrorKind,
    readonly code: string
  ) {
    super(`report mail error ${code}`);
    this.name = "ReportMailError";
  }
}

export interface ReportMailbox {
  /** Appends the message to the INBOX of the mailbox. Throws `ReportMailError`; a message that was appended is not appended again by the port. */
  append(ctx: TenantContext, mailboxId: string, message: ReportMailMessage): Promise<void>;
}
