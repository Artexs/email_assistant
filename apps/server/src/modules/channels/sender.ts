import { isQuietTime, quietEnd } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { markDigestSent } from "../reports";
import { getOrganization } from "../tenancy";

import { ChannelError, type ChatChannel } from "./port";
import {
  claimDueOutbox,
  failOutbox,
  getChatLinkForUser,
  markOutboxSent,
  releaseOutbox,
  type ClaimedOutbox,
  type OutboxFailCode,
} from "./repo";

const log = createLog("channels");

export const SENDER_STALE_MS = 5 * 60_000;
export const OUTBOX_MAX_AGE_MS = 24 * 3_600_000;
export const SOFT_BACKOFF_START_MS = 30_000;
export const SOFT_BACKOFF_MAX_MS = 15 * 60_000;
export const CONFIG_PAUSE_MS = 10 * 60_000;
export const MAX_OTHER_ERRORS = 5;

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_PER_USER_LIMIT = 3;

export interface SenderDeps {
  db: Db | Transaction<DB>;
  channel: ChatChannel;
  now(): Date;
  batchSize?: number;
  perUserLimit?: number;
}

function backoff(attempt: number): number {
  return Math.min(SOFT_BACKOFF_START_MS * 2 ** (attempt - 1), SOFT_BACKOFF_MAX_MS);
}

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

// Log lines hold the row id, the kind, codes and seconds only: never the text, the buttons, the chat id or a name.
export function createOutboxSender(deps: SenderDeps): { run(): Promise<void> } {
  const { db, channel } = deps;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const perUserLimit = deps.perUserLimit ?? DEFAULT_PER_USER_LIMIT;
  let pausedUntil: Date | null = null;

  async function guarded(action: () => Promise<unknown>, id: string): Promise<void> {
    try {
      await action();
    } catch (error) {
      log.error(`outbox ${id}: database call failed (${describeError(error)})`);
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
      log.error(`outbox claim failed (${describeError(error)})`);
      return;
    }

    const timezones = new Map<string, string>();
    const sentPerUser = new Map<string, number>();

    async function timezoneOf(ctx: TenantContext): Promise<string> {
      const cached = timezones.get(ctx.orgId);
      if (cached !== undefined) return cached;
      const org = await getOrganization(db, ctx);
      if (!org) throw new Error("organization not found");
      timezones.set(ctx.orgId, org.timezone);
      return org.timezone;
    }

    for (const [index, row] of claimed.entries()) {
      const ctx = { orgId: row.orgId };
      const later = claimed.slice(index + 1);
      let sent = false;
      try {
        if (row.wasStale) {
          log.warn(`outbox ${row.id}: sent again after a stale send (a duplicate is possible)`);
        }
        if (now.getTime() - row.createdAt.getTime() > OUTBOX_MAX_AGE_MS) {
          await fail(row, "expired");
          log.warn(`outbox ${row.id}: expired`);
          continue;
        }
        const timezone = await timezoneOf(ctx);
        if (row.kind !== "digest" && isQuietTime(now, timezone)) {
          await release(row, quietEnd(now, timezone), false);
          continue;
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
          log.warn(`outbox ${row.id}: the member has no chat`);
          continue;
        }

        const { messageId } = await channel.send(link.chatId, { text: row.text, buttons: row.buttons });
        sent = true;
        sentPerUser.set(userKey, sentCount + 1);

        const markSent = async (trx: Transaction<DB>): Promise<boolean> => {
          const ok = await markOutboxSent(trx, ctx, row.id, row.lockedAt, { messageId, at: now });
          if (ok && row.kind === "digest" && row.digestId !== null) {
            await markDigestSent(trx, ctx, row.digestId, now);
          }
          return ok;
        };
        const marked = await (db.isTransaction ? markSent(db as Transaction<DB>) : db.transaction().execute(markSent));
        if (!marked) {
          log.warn(`outbox ${row.id}: lost the claim after the send`);
        }
        log.info(`outbox ${row.id}: sent ${row.kind}`);
      } catch (error) {
        if (error instanceof ChannelError) {
          switch (error.kind) {
            case "rate_limited": {
              const next = new Date(now.getTime() + (error.retryAfterMs ?? SOFT_BACKOFF_START_MS));
              await release(row, next, false);
              await releaseAll(later, next);
              pausedUntil = next;
              log.warn(
                `outbox ${row.id}: rate limited; sending paused for ${seconds(next.getTime() - now.getTime())} s`
              );
              return;
            }
            case "soft": {
              const wait = backoff(row.attempts + 1);
              const next = new Date(now.getTime() + wait);
              await release(row, next, true);
              await releaseAll(later, next);
              pausedUntil = next;
              log.warn(`outbox ${row.id}: ${error.code}; sending paused for ${seconds(wait)} s`);
              return;
            }
            case "config": {
              const next = new Date(now.getTime() + CONFIG_PAUSE_MS);
              await release(row, next, false);
              await releaseAll(later, next);
              pausedUntil = next;
              log.error("telegram token rejected (401): check TELEGRAM_BOT_TOKEN; sending paused for 10 min");
              return;
            }
            case "blocked":
              await fail(row, "blocked");
              log.warn(`outbox ${row.id}: the user blocked the bot (403)`);
              continue;
            case "bad_request":
              await fail(row, "bad_request");
              log.error(`outbox ${row.id}: Telegram refused the message (${error.code})`);
              continue;
            case "other":
              if (row.attempts + 1 >= MAX_OTHER_ERRORS) {
                await fail(row, "too_many_errors");
              } else {
                await release(row, new Date(now.getTime() + backoff(row.attempts + 1)), true);
              }
              log.error(`outbox ${row.id}: ${error.code}`);
              continue;
          }
        }
        // A database error. After a send the row stays `sending`: the next claim after 5 min sends it again (D4).
        if (!sent) {
          await release(row, new Date(now.getTime() + backoff(row.attempts + 1)), true);
        }
        log.error(`outbox ${row.id}: ${describeError(error)}`);
      }
    }
  }

  return { run };
}
