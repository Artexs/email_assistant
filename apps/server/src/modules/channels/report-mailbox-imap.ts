import type { ReportMailMessage } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { SoftError } from "../../platform/errors";
import {
  composeReportMail,
  HostNotAllowedError,
  INBOX,
  locateByMessageId,
  MailAuthError,
  MailboxNotFoundError,
  OAuthGrantError,
  openMailboxProvider,
  type OpenDeps,
} from "../mail";

import { ReportMailError, type AppendOptions, type ReportMailbox } from "./report-mailbox";

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
  // A revoked or refused OAuth grant: the token refresh fails until the user connects again, so the row waits like a refused login.
  if (error instanceof OAuthGrantError) return new ReportMailError("unavailable", "oauth_grant");
  if (error instanceof SoftError) return new ReportMailError("soft", "open_network");
  return new ReportMailError("other", "open_failed");
}

export function createImapReportMailbox(deps: ImapReportMailboxDeps): ReportMailbox {
  return {
    async append(
      ctx: TenantContext,
      mailboxId: string,
      message: ReportMailMessage,
      opts: AppendOptions
    ): Promise<"appended" | "found"> {
      const raw = await composeReportMail(message);
      let provider;
      try {
        ({ provider } = await openMailboxProvider(deps, ctx, mailboxId));
      } catch (error) {
        throw openError(error);
      }
      try {
        // A retry looks for the message first: the earlier try may have stored it before the mark or the answer was lost. The fixed
        // Message-ID is the identity. A read failure is a network failure or an unknown one, never a reason to APPEND blind.
        if (opts.retry) {
          let found;
          try {
            found = await locateByMessageId(provider, INBOX, { messageId: message.messageId, since: opts.since });
          } catch (error) {
            throw error instanceof SoftError
              ? new ReportMailError("soft", "locate_network")
              : new ReportMailError("other", "locate_failed");
          }
          if (found !== null) return "found";
        }
        // No flags: the mail shows as new in the INBOX. The internal date is the time of the append.
        await provider.appendMessage(INBOX, raw, [], deps.now());
        return "appended";
      } catch (error) {
        if (error instanceof ReportMailError) throw error;
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
