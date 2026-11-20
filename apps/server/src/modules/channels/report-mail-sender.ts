import { buildReportMail, renderNotice, reportMailKinds, type ReportMailKind, MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { getMailbox } from "../mail";
import { markDigestSent } from "../reports";
import { getMemberNotify, isFeatureOn } from "../tenancy";

import { createQuietGate } from "./quiet-gate";
import {
  claimDueOutbox,
  countOutboxAttempt,
  expireOldMailOutbox,
  failOutbox,
  markOutboxSent,
  releaseOutbox,
  type ClaimedOutbox,
  type OutboxFailCode,
} from "./repo";
import { ReportMailError, type ReportMailbox } from "./report-mailbox";
import { backoff, MAX_OTHER_ERRORS, OUTBOX_MAX_AGE_MS, SENDER_STALE_MS } from "./sender";

const log = createLog("channels");

// A row that cannot go now (the flag is off, the mailbox is not `active`) is looked at again after this time, with no attempt counted.
export const REPORT_MAIL_WAIT_MS = 15 * MINUTE_MS;
const DEFAULT_BATCH_SIZE = 20;

export interface ReportMailSenderDeps {
  db: Db | Transaction<DB>;
  mailbox: ReportMailbox;
  now(): Date;
  /** `WEB_BASE_URL`. Only a link that starts with it becomes a link in the HTML part. */
  webBaseUrl?: string;
  batchSize?: number;
}

const isReportMailKind = (kind: string): kind is ReportMailKind =>
  (reportMailKinds as readonly string[]).includes(kind);

// ADR 0022 point 1: appends the `mail` rows of the outbox to the INBOX of their mailbox. It never sends: the port APPENDs
// and nothing here opens an SMTP or Graph sender. The recipient is the mailbox of the row, read from the mailbox table at send time.
// Log lines hold the row id, the kind and codes only: never the text, a subject or an address.
export function createReportMailSender(deps: ReportMailSenderDeps): { run(): Promise<void> } {
  const { db } = deps;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const linkBase = deps.webBaseUrl ?? null;

  async function guarded(action: () => Promise<unknown>, id: string): Promise<void> {
    try {
      await action();
    } catch (error) {
      log.error("outbox_db_failed", { outbox_id: id, ...errorFields(error) });
    }
  }

  const release = (row: ClaimedOutbox, next: Date, countAttempt: boolean): Promise<void> =>
    guarded(
      () => releaseOutbox(db, { orgId: row.orgId }, row.id, row.lockedAt, { nextAttemptAt: next, countAttempt }),
      row.id
    );

  const fail = (row: ClaimedOutbox, code: OutboxFailCode): Promise<void> =>
    guarded(() => failOutbox(db, { orgId: row.orgId }, row.id, row.lockedAt, code), row.id);

  async function run(): Promise<void> {
    const now = deps.now();
    // A mail row that no run could send within the life of a row ends as `failed` / `expired`, as a Telegram row does. The sweep runs
    // before the claim with the same cut, so a claimed row is never older than the life of a row.
    try {
      const expired = await expireOldMailOutbox(db, { before: new Date(now.getTime() - OUTBOX_MAX_AGE_MS) });
      if (expired > 0) log.warn("outbox_mail_expired", { count: expired });
    } catch (error) {
      log.error("outbox_mail_expire_failed", { ...errorFields(error) });
    }

    let claimed: ClaimedOutbox[];
    try {
      claimed = await claimDueOutbox(db, {
        now,
        limit: batchSize,
        staleBefore: new Date(now.getTime() - SENDER_STALE_MS),
        channel: "mail",
      });
    } catch (error) {
      log.error("outbox_claim_failed", { ...errorFields(error) });
      return;
    }

    const quiet = createQuietGate({ db, now, claimed });
    const flagged = new Map<string, boolean>();
    // A mailbox that failed in this run: its later rows wait for the same time and count no attempt.
    const heldMailboxes = new Map<string, Date>();

    async function flagOn(orgId: string): Promise<boolean> {
      let on = flagged.get(orgId);
      if (on === undefined) {
        on = await isFeatureOn(db, { orgId }, "report_mail");
        flagged.set(orgId, on);
      }
      return on;
    }

    for (const row of claimed) {
      const ctx = { orgId: row.orgId };
      const outboxLog = log.with({ outbox_id: row.id });
      let appended = false;
      // The attempts of the row, with the one that a stale reclaim counts below.
      let attempts = row.attempts;
      try {
        // A row that a dead run left `sending`: the APPEND may have landed. This claim counts an attempt, so a row that keeps crashing its
        // sender ends as `too_many_errors`, and the adapter looks for the message before it appends again.
        if (row.wasStale) {
          outboxLog.warn("outbox_mail_resent_after_stale");
          if (attempts + 1 >= MAX_OTHER_ERRORS) {
            await fail(row, "too_many_errors");
            continue;
          }
          await guarded(() => countOutboxAttempt(db, ctx, row.id, row.lockedAt), row.id);
          attempts += 1;
        }
        // A mail row names its mailbox and one of the four report kinds; a row that does not is a bad row, never a message.
        if (row.mailboxId === null || !isReportMailKind(row.kind)) {
          await fail(row, "bad_view");
          outboxLog.error("outbox_bad_view", { kind: row.kind });
          continue;
        }
        const { mailboxId, kind } = { mailboxId: row.mailboxId, kind: row.kind };
        // The flag is the kill switch: with it off nothing is appended, and the row waits (it expires after 24 h).
        if (!(await flagOn(row.orgId))) {
          await release(row, new Date(now.getTime() + REPORT_MAIL_WAIT_MS), false);
          continue;
        }
        // The member chose this channel and this mailbox when the row was queued; a later change (back to Telegram, another
        // mailbox) makes the row outdated. Nothing goes into a mailbox that the member no longer chose.
        const notify = await getMemberNotify(db, ctx, row.userId);
        if (notify === undefined || notify.report_channel === "telegram" || notify.report_mailbox_id !== mailboxId) {
          await fail(row, "outdated");
          outboxLog.warn("outbox_mail_outdated");
          continue;
        }
        const heldUntil = heldMailboxes.get(mailboxId);
        if (heldUntil !== undefined) {
          await release(row, heldUntil, false);
          continue;
        }
        const timezone = await quiet.timezoneOf(ctx);
        // Quiet hours hold every report kind except the digest (as for Telegram rows).
        if (kind !== "digest") {
          const until = await quiet.holdUntil(row, timezone);
          if (until !== null) {
            await release(row, until, false);
            continue;
          }
        }
        // A mail row always goes through the mail renderer: a stored Telegram text never reaches the mailbox.
        const rendered = renderNotice(kind, row.view, { channel: "mail", detail: row.detail, locale: row.locale });
        if (!rendered.ok) {
          await fail(row, "bad_view");
          outboxLog.error("outbox_bad_view", { kind });
          continue;
        }
        // The status is read again right before the APPEND: a mailbox that was paused, or lost its login, since the row was queued
        // takes no mail. The address is the one of the mailbox row, never a value from a notice.
        const mailbox = await getMailbox(db, ctx, mailboxId);
        if (mailbox === undefined) {
          await fail(row, "outdated");
          outboxLog.warn("outbox_mail_no_mailbox");
          continue;
        }
        if (mailbox.status !== "active") {
          const next = new Date(now.getTime() + REPORT_MAIL_WAIT_MS);
          heldMailboxes.set(mailboxId, next);
          await release(row, next, false);
          outboxLog.info("outbox_mail_waits", { code: mailbox.status });
          continue;
        }
        const message = buildReportMail({
          outboxId: row.id,
          kind,
          mailboxAddress: mailbox.address,
          locale: row.locale,
          text: rendered.message.text,
          now,
          linkBase,
        });
        // A row that was tried before may have its message in the INBOX already: the adapter finds it and appends nothing.
        const result = await deps.mailbox.append(ctx, mailboxId, message, {
          retry: attempts > 0,
          since: row.createdAt,
        });
        appended = true;
        if (result === "found") outboxLog.info("outbox_mail_found");

        const markSent = async (trx: Transaction<DB>): Promise<boolean> => {
          const ok = await markOutboxSent(trx, ctx, row.id, row.lockedAt, {
            messageId: null,
            at: now,
            message: rendered.message,
          });
          // The digest of a mail-only member is sent when its mail row is; for a member with both rows the first sender wins.
          if (ok && kind === "digest" && row.digestId !== null) await markDigestSent(trx, ctx, row.digestId, now);
          return ok;
        };
        const marked = await (db.isTransaction ? markSent(db as Transaction<DB>) : db.transaction().execute(markSent));
        if (!marked) outboxLog.warn("outbox_claim_lost");
        outboxLog.info("outbox_sent", { kind });
      } catch (error) {
        if (error instanceof ReportMailError) {
          switch (error.kind) {
            case "unavailable": {
              const next = new Date(now.getTime() + REPORT_MAIL_WAIT_MS);
              if (row.mailboxId !== null) heldMailboxes.set(row.mailboxId, next);
              await release(row, next, false);
              outboxLog.warn("outbox_mail_waits", { code: error.code });
              continue;
            }
            case "soft": {
              const next = new Date(now.getTime() + backoff(attempts + 1));
              if (row.mailboxId !== null) heldMailboxes.set(row.mailboxId, next);
              await release(row, next, true);
              outboxLog.warn("outbox_paused", { code: error.code, wait_ms: next.getTime() - now.getTime() });
              continue;
            }
            case "refused":
              // The other rows of this mailbox wait too: a full mailbox refuses each of them, and each try is a login.
              if (row.mailboxId !== null) {
                heldMailboxes.set(row.mailboxId, new Date(now.getTime() + REPORT_MAIL_WAIT_MS));
              }
              await fail(row, "append_refused");
              outboxLog.error("outbox_refused", { code: error.code });
              continue;
            case "other": {
              const next = new Date(now.getTime() + backoff(attempts + 1));
              // The other rows of this mailbox wait for the same time and count no attempt: one login per mailbox per run.
              if (row.mailboxId !== null) heldMailboxes.set(row.mailboxId, next);
              if (attempts + 1 >= MAX_OTHER_ERRORS) {
                await fail(row, "too_many_errors");
              } else {
                await release(row, next, true);
              }
              outboxLog.error("outbox_failed", { code: error.code });
              continue;
            }
          }
        }
        // A database error. After an APPEND the row stays `sending`: the next claim after 5 min counts an attempt and finds the message
        // in the INBOX, so nothing is appended twice.
        if (!appended) await release(row, new Date(now.getTime() + backoff(attempts + 1)), true);
        outboxLog.error("outbox_failed", { ...errorFields(error) });
      }
    }
  }

  return { run };
}
