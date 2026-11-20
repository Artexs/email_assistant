import { renderNotice, type NoticeDetail, type OutMessage, DAY_MS, MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { markDigestSent } from "../reports";

import { checkCardEdit } from "./card-edit-check";
import { createDetailGate } from "./detail";
import { ChannelError, type ChatChannel } from "./port";
import { createQuietGate } from "./quiet-gate";
import {
  claimDueOutbox,
  failOutbox,
  getChatLinkForUser,
  markOutboxSent,
  releaseOutbox,
  type ClaimedOutbox,
  type OutboxFailCode,
} from "./repo";
import { isAskedForKey } from "./review-keys";

const log = createLog("channels");

export const SENDER_STALE_MS = 5 * MINUTE_MS;
export const OUTBOX_MAX_AGE_MS = DAY_MS;
export const SOFT_BACKOFF_START_MS = 30_000;
export const SOFT_BACKOFF_MAX_MS = 15 * MINUTE_MS;
export const CONFIG_PAUSE_MS = 10 * MINUTE_MS;
export const MAX_OTHER_ERRORS = 5;

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_PER_USER_LIMIT = 3;

export interface SenderDeps {
  db: Db | Transaction<DB>;
  channel: ChatChannel;
  now(): Date;
  batchSize?: number;
  perUserLimit?: number;
  // The base URL of the panel (`WEB_BASE_URL`): the `minimal` text ends with a link built from it. Unset: the line "Open the panel".
  webBaseUrl?: string;
}

export function backoff(attempt: number): number {
  return Math.min(SOFT_BACKOFF_START_MS * 2 ** (attempt - 1), SOFT_BACKOFF_MAX_MS);
}

// Log lines hold the row id, the kind, codes and milliseconds only: never the text, the buttons, the chat id or a name.
export function createOutboxSender(deps: SenderDeps): { run(): Promise<void> } {
  const { db, channel } = deps;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const perUserLimit = deps.perUserLimit ?? DEFAULT_PER_USER_LIMIT;
  let pausedUntil: Date | null = null;

  async function guarded(action: () => Promise<unknown>, id: string): Promise<void> {
    try {
      await action();
    } catch (error) {
      log.error("outbox_db_failed", { outbox_id: id, ...errorFields(error) });
    }
  }

  function release(row: ClaimedOutbox, next: Date, countAttempt: boolean): Promise<void> {
    return guarded(
      () => releaseOutbox(db, { orgId: row.orgId }, row.id, row.lockedAt, { nextAttemptAt: next, countAttempt }),
      row.id
    );
  }

  function fail(row: ClaimedOutbox, code: OutboxFailCode): Promise<void> {
    return guarded(() => failOutbox(db, { orgId: row.orgId }, row.id, row.lockedAt, code), row.id);
  }

  async function releaseAll(rows: ClaimedOutbox[], next: Date): Promise<void> {
    for (const row of rows) await release(row, next, false);
  }

  async function run(): Promise<void> {
    const now = deps.now();
    if (pausedUntil !== null && now < pausedUntil) return;

    let claimed: ClaimedOutbox[];
    try {
      claimed = await claimDueOutbox(db, {
        now,
        limit: batchSize,
        staleBefore: new Date(now.getTime() - SENDER_STALE_MS),
      });
    } catch (error) {
      log.error("outbox_claim_failed", { ...errorFields(error) });
      return;
    }

    const sentPerUser = new Map<string, number>();
    // The quiet hours of the users of this batch, read once. A row that quiet hours never hold (digest, edit) needs no hours.
    const quiet = createQuietGate({ db, now, claimed });
    // The detail levels of the members of this batch, read once (flag `telegram_minimal`, the lock of the organization, the level of the member).
    const levels = createDetailGate({ db, claimed });

    for (const [index, row] of claimed.entries()) {
      const ctx = { orgId: row.orgId };
      const outboxLog = log.with({ outbox_id: row.id });
      const later = claimed.slice(index + 1);
      let sent = false;
      try {
        if (row.wasStale) {
          outboxLog.warn("outbox_resent_after_stale");
        }
        if (now.getTime() - row.createdAt.getTime() > OUTBOX_MAX_AGE_MS) {
          await fail(row, "expired");
          outboxLog.warn("outbox_expired");
          continue;
        }
        // A row with a text is sent as it is (rows queued before send-time rendering); every other row is rendered now
        // (ADR 0032 point 5).
        let message: OutMessage;
        // The level of a row that was rendered now; a row with a stored text keeps the level it has.
        let renderedDetail: NoticeDetail | undefined;
        if (row.text !== null) {
          message = {
            text: row.text,
            buttons: row.buttons,
            ...(row.kind === "reply_prompt" ? { forceReply: true as const } : {}),
          };
        } else {
          renderedDetail = await levels.detailOf(row);
          const rendered = renderNotice(row.kind, row.view, {
            channel: row.channel,
            detail: renderedDetail,
            locale: row.locale,
            ...(deps.webBaseUrl === undefined ? {} : { webBaseUrl: deps.webBaseUrl }),
          });
          if (!rendered.ok) {
            await fail(row, "bad_view");
            outboxLog.error("outbox_bad_view", { kind: row.kind });
            continue;
          }
          message = rendered.message;
        }
        // An edit of a card that was sent: it makes no sound, so quiet hours do not hold it back. It checks
        // that its outcome is still the one of the send before it takes a place in the per-user limit.
        const isEdit = row.kind === "approval_edit";
        let editCheck: Awaited<ReturnType<typeof checkCardEdit>> | undefined;
        if (isEdit) {
          editCheck = await checkCardEdit(db, row);
          if (!editCheck.ok) {
            await fail(row, editCheck.code);
            outboxLog.warn("outbox_edit_dropped", { code: editCheck.code });
            continue;
          }
        }
        const timezone = await quiet.timezoneOf(ctx);
        // The digest, a card edit and a message that the owner asked for with a tap or a line of text (a review card, the question after
        // Redraft, the result of a request) are never held: the user is awake and waits for it.
        if (row.kind !== "digest" && !isEdit && !isAskedForKey(row.kind, row.dedupKey)) {
          const until = await quiet.holdUntil(row, timezone);
          if (until !== null) {
            await release(row, until, false);
            continue;
          }
        }
        const userKey = `${row.orgId}:${row.userId}`;
        const sentCount = sentPerUser.get(userKey) ?? 0;
        if (sentCount >= perUserLimit) {
          await release(row, now, false);
          continue;
        }
        const link = await getChatLinkForUser(db, ctx, row.userId);
        if (!link) {
          await fail(row, "no_chat");
          outboxLog.warn("outbox_no_chat");
          continue;
        }

        let messageId: number;
        if (editCheck?.ok) {
          // Message ids belong to one chat: a card sent before the user linked another chat is not there.
          const { target } = editCheck;
          if (target.sentAt === null || link.linkedAt > target.sentAt) {
            await fail(row, "no_target");
            outboxLog.warn("outbox_edit_dropped", { code: "no_target" });
            continue;
          }
          await channel.edit(link.chatId, target.messageId, message);
          messageId = target.messageId;
        } else {
          ({ messageId } = await channel.send(link.chatId, message));
        }
        sent = true;
        sentPerUser.set(userKey, sentCount + 1);

        const markSent = async (trx: Transaction<DB>): Promise<boolean> => {
          const ok = await markOutboxSent(trx, ctx, row.id, row.lockedAt, {
            messageId,
            at: now,
            message,
            ...(renderedDetail === undefined ? {} : { detail: renderedDetail }),
          });
          if (ok && row.kind === "digest" && row.digestId !== null) {
            await markDigestSent(trx, ctx, row.digestId, now);
          }
          return ok;
        };
        const marked = await (db.isTransaction ? markSent(db as Transaction<DB>) : db.transaction().execute(markSent));
        if (!marked) {
          outboxLog.warn("outbox_claim_lost");
        }
        outboxLog.info("outbox_sent", { kind: row.kind });
      } catch (error) {
        if (error instanceof ChannelError) {
          switch (error.kind) {
            case "rate_limited": {
              const next = new Date(now.getTime() + (error.retryAfterMs ?? SOFT_BACKOFF_START_MS));
              await release(row, next, false);
              await releaseAll(later, next);
              pausedUntil = next;
              outboxLog.warn("outbox_rate_limited", { wait_ms: next.getTime() - now.getTime() });
              return;
            }
            case "soft": {
              const wait = backoff(row.attempts + 1);
              const next = new Date(now.getTime() + wait);
              await release(row, next, true);
              await releaseAll(later, next);
              pausedUntil = next;
              outboxLog.warn("outbox_paused", { code: error.code, wait_ms: wait });
              return;
            }
            case "config": {
              const next = new Date(now.getTime() + CONFIG_PAUSE_MS);
              await release(row, next, false);
              await releaseAll(later, next);
              pausedUntil = next;
              outboxLog.error("outbox_token_rejected");
              return;
            }
            // No retry for an edit that Telegram refused (the message is too old, gone or the same): the card stays as it is.
            case "blocked":
              await fail(row, row.kind === "approval_edit" ? "edit_failed" : "blocked");
              outboxLog.warn("outbox_bot_blocked");
              continue;
            case "bad_request":
              await fail(row, row.kind === "approval_edit" ? "edit_failed" : "bad_request");
              outboxLog.error("outbox_refused", { code: error.code });
              continue;
            case "other":
              if (row.attempts + 1 >= MAX_OTHER_ERRORS) {
                await fail(row, "too_many_errors");
              } else {
                await release(row, new Date(now.getTime() + backoff(row.attempts + 1)), true);
              }
              outboxLog.error("outbox_failed", { code: error.code });
              continue;
          }
        }
        // A database error. After a send the row stays `sending`: the next claim after 5 min sends it again.
        if (!sent) {
          await release(row, new Date(now.getTime() + backoff(row.attempts + 1)), true);
        }
        outboxLog.error("outbox_failed", { ...errorFields(error) });
      }
    }
  }

  return { run };
}
