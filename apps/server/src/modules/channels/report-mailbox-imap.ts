import type { ReportMailMessage } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { SoftError } from "../../platform/errors";
import {
  composeReportMail,
  HostNotAllowedError,
  INBOX,
  MailAuthError,
  MailboxNotFoundError,
  openMailboxProvider,
  type OpenDeps,
} from "../mail";

import { ReportMailError, type ReportMailbox } from "./report-mailbox";

// The deps of the IMAP adapter. `Pick`: no SMTP sender and no Graph sender can be passed in, and `openMailboxProvider` is called without
// `withSender`, so this adapter cannot send a mail. An OAuth mailbox opens through `oauthTokens`, as the committer's draft APPEND does.
export type ImapReportMailboxDeps = Pick<OpenDeps, "db" | "secrets" | "openProvider" | "oauthTokens"> & {
  now(): Date;
};

// A login or host refusal, or a mailbox that is gone, leaves the row waiting: the mail sync job owns the mailbox status.
function openError(error: unknown): ReportMailError {
  if (error instanceof MailAuthError) return new ReportMailError("unavailable", "auth_error");
  if (error instanceof HostNotAllowedError) return new ReportMailError("unavailable", "host_blocked");
  if (error instanceof MailboxNotFoundError) return new ReportMailError("unavailable", "no_mailbox");
  if (error instanceof SoftError) return new ReportMailError("soft", "open_network");
  return new ReportMailError("other", "open_failed");
}

export function createImapReportMailbox(deps: ImapReportMailboxDeps): ReportMailbox {
  return {
    async append(ctx: TenantContext, mailboxId: string, message: ReportMailMessage): Promise<void> {
      const raw = await composeReportMail(message);
      let provider;
      try {
        ({ provider } = await openMailboxProvider(deps, ctx, mailboxId));
      } catch (error) {
        throw openError(error);
      }
      try {
        // No flags: the mail shows as new in the INBOX. The internal date is the time of the append.
        await provider.appendMessage(INBOX, raw, [], deps.now());
      } catch (error) {
        // The IMAP client turns a connection failure into `SoftError`; every other failure of an APPEND is the answer of the server.
        throw error instanceof SoftError
          ? new ReportMailError("soft", "append_network")
          : new ReportMailError("refused", "append_refused");
      } finally {
        await provider.close().catch(() => undefined);
      }
    },
  };
}
