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

export interface AppendOptions {
  /**
   * The row was tried before (a stale reclaim, or an earlier attempt): the message may be in the INBOX already. The port looks for its
   * fixed Message-ID first and does not APPEND when it finds it.
   */
  retry: boolean;
  /** When the row was queued: the earliest time the message can have been stored. */
  since: Date;
}

export interface ReportMailbox {
  /**
   * Appends the message to the INBOX of the mailbox. Answers `found` when `retry` is set and the message is there already (nothing was
   * appended), else `appended`. Throws `ReportMailError`.
   */
  append(
    ctx: TenantContext,
    mailboxId: string,
    message: ReportMailMessage,
    opts: AppendOptions
  ): Promise<"appended" | "found">;
}
