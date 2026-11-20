import { createHash } from "node:crypto";

import { noticeGroupOf, pushPayloadSchema, renderNotice, MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { CryptoKeyVersionError, type SecretBox } from "../../platform/crypto";
import type { DB, Db } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { isFeatureOn } from "../tenancy";

import {
  listLiveDeviceIds,
  loadDeviceSecret,
  markPushError,
  markPushSuccess,
  queueTelegramFallback,
  removeDevice,
  sendWebPush,
  type PushResult,
  type VapidKeys,
} from "./push";
import { createQuietGate } from "./quiet-gate";
import {
  claimDueOutbox,
  countOutboxAttempt,
  failOutbox,
  markOutboxSent,
  releaseOutbox,
  type ClaimedOutbox,
  type OutboxFailCode,
} from "./repo";
import { backoff, CONFIG_PAUSE_MS, MAX_OTHER_ERRORS, OUTBOX_MAX_AGE_MS, SENDER_STALE_MS } from "./sender";

const log = createLog("channels");

// A row that waits for the flag `web_push` is looked at again after this time, with no attempt counted.
export const PUSH_FLAG_WAIT_MS = 15 * MINUTE_MS;
/** The life of a row and of a message at the push service. A message gets what is left of it: `PUSH_TTL_SECONDS` minus the row age. */
export const PUSH_TTL_SECONDS = 86_400;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_PER_USER_LIMIT = 3;

export interface PushSenderDeps {
  db: Db | Transaction<DB>;
  /** The box that opens the endpoint and the keys of a device (ADR 0009). */
  box: SecretBox;
  keys: VapidKeys;
  /**
   * The request goes through this function: the global `fetch` in production, a fake push service in tests. Bun's `fetch` honours
   * the proxy variables (`HTTPS_PROXY`) of the process: the server keeps that on purpose (a host that must reach the internet
   * through an egress proxy needs it), and the proxy then sees the push host, the VAPID token (valid 12 h for that one push
   * service) and the encrypted body, never a payload in clear. The endpoint host check runs in `sendWebPush` before any request.
   */
  fetch: typeof fetch;
  now(): Date;
  batchSize?: number;
  perUserLimit?: number;
}

// The topic of a push (RFC 8030): a short URL-safe name per row. A later message with the same topic replaces one that waits at the
// push service; the row id makes it unique, so no notice replaces another.
export function pushTopicOf(rowId: string): string {
  return createHash("sha256").update(rowId, "utf8").digest("base64url").slice(0, 32);
}

// ADR 0032: the phone channel. It claims the `push` rows of the outbox (one per device) and sends each as one Web Push message that
// holds a kind, a count and an id. The order per row: too old; flag off; quiet hours; the limit per user; the device (live,
// readable); the render; the send. At least once: a crash after the send leaves the row `sending`, and the next claim after 5 min
// sends it again (the service worker shows one notice per row id, so a repeat replaces the first).
// Log lines hold the row id, the device id, the kind, a code and a status number: never an endpoint, a key, a token or a payload.
export function createPushSender(deps: PushSenderDeps): { run(): Promise<void> } {
  const { db, box, keys } = deps;
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

  const release = (row: ClaimedOutbox, next: Date, countAttempt: boolean): Promise<void> =>
    guarded(
      () => releaseOutbox(db, { orgId: row.orgId }, row.id, row.lockedAt, { nextAttemptAt: next, countAttempt }),
      row.id
    );

  const fail = (row: ClaimedOutbox, code: OutboxFailCode): Promise<void> =>
    guarded(() => failOutbox(db, { orgId: row.orgId }, row.id, row.lockedAt, code), row.id);

  // The device of a row is gone and nothing ended the row yet: it ends `no_device`, and its event falls back to Telegram when the
  // member has a chat and the row holds no loop. The row ends only when this run still owns its claim.
  const endNoDevice = (row: ClaimedOutbox): Promise<void> =>
    guarded(
      () =>
        inTransaction(async (trx) => {
          const ended = await failOutbox(trx, { orgId: row.orgId }, row.id, row.lockedAt, "no_device");
          if (ended) await queueTelegramFallback(trx, { orgId: row.orgId }, row);
        }),
      row.id
    );

  async function releaseAll(rows: ClaimedOutbox[], next: Date): Promise<void> {
    for (const row of rows) await release(row, next, false);
  }

  const inTransaction = <T>(action: (trx: Transaction<DB>) => Promise<T>): Promise<T> =>
    db.isTransaction ? action(db as Transaction<DB>) : (db as Db).transaction().execute(action);

  async function run(): Promise<void> {
    const now = deps.now();
    if (pausedUntil !== null && now < pausedUntil) return;

    let claimed: ClaimedOutbox[];
    try {
      claimed = await claimDueOutbox(db, {
        now,
        limit: batchSize,
        staleBefore: new Date(now.getTime() - SENDER_STALE_MS),
        channel: "push",
      });
    } catch (error) {
      log.error("outbox_claim_failed", { ...errorFields(error) });
      return;
    }

    const quiet = createQuietGate({ db, now, claimed });
    const flagged = new Map<string, boolean>();
    const liveOfUser = new Map<string, Set<string>>();
    const sentPerUser = new Map<string, number>();

    async function flagOn(orgId: string): Promise<boolean> {
      let on = flagged.get(orgId);
      if (on === undefined) {
        on = await isFeatureOn(db, { orgId }, "web_push");
        flagged.set(orgId, on);
      }
      return on;
    }

    async function liveDevices(orgId: string, userId: string): Promise<Set<string>> {
      const key = `${orgId}:${userId}`;
      let live = liveOfUser.get(key);
      if (live === undefined) {
        live = new Set((await listLiveDeviceIds(db, { orgId }, userId, now)).map((device) => device.id));
        liveOfUser.set(key, live);
      }
      return live;
    }

    for (const [index, row] of claimed.entries()) {
      const ctx = { orgId: row.orgId };
      const outboxLog = log.with({ outbox_id: row.id });
      const later = claimed.slice(index + 1);
      let posted = false;
      try {
        // A row that a dead run left `sending`: the push may have gone out. This claim counts an attempt, so a row that keeps crashing
        // its sender ends as `too_many_errors`.
        let attempts = row.attempts;
        if (row.wasStale) {
          outboxLog.warn("outbox_push_resent_after_stale");
          if (attempts + 1 >= MAX_OTHER_ERRORS) {
            await fail(row, "too_many_errors");
            continue;
          }
          await guarded(() => countOutboxAttempt(db, ctx, row.id, row.lockedAt), row.id);
          attempts += 1;
        }
        if (now.getTime() - row.createdAt.getTime() > OUTBOX_MAX_AGE_MS) {
          await fail(row, "expired");
          outboxLog.warn("outbox_expired");
          continue;
        }
        // The flag is the kill switch: with it off nothing goes out, and the row waits (it expires after 24 h).
        if (!(await flagOn(row.orgId))) {
          await release(row, new Date(now.getTime() + PUSH_FLAG_WAIT_MS), false);
          continue;
        }
        // Quiet hours hold every push kind: a push makes a sound on the phone.
        const timezone = await quiet.timezoneOf(ctx);
        const until = await quiet.holdUntil(row, timezone);
        if (until !== null) {
          await release(row, until, false);
          continue;
        }
        const userKey = `${row.orgId}:${row.userId}`;
        const sentCount = sentPerUser.get(userKey) ?? 0;
        if (sentCount >= perUserLimit) {
          await release(row, now, false);
          continue;
        }
        // The device must exist and be live: a session that ended or expired ends the push (the device goes, the row ends `no_device`).
        const deviceId = row.pushSubscriptionId;
        if (deviceId === null) {
          await endNoDevice(row);
          outboxLog.warn("push_no_device", { kind: row.kind });
          continue;
        }
        if (!(await liveDevices(row.orgId, row.userId)).has(deviceId)) {
          // `removeDevice` ends this row and every other open row of the device, each with its fallback; `endNoDevice` covers a device
          // that was removed by another run a moment ago.
          await inTransaction((trx) => removeDevice(trx, ctx, deviceId));
          await endNoDevice(row);
          outboxLog.warn("push_device_gone", { kind: row.kind, push_subscription_id: deviceId, code: "session_ended" });
          continue;
        }
        const secret = await inTransaction((trx) => loadDeviceSecret(trx, ctx, deviceId, box));
        if (secret === null) {
          await endNoDevice(row);
          // No device row: removed earlier in this run (a 410 of another row), or a secret that did not open (its own line says so).
          outboxLog.warn("push_no_device", { kind: row.kind, push_subscription_id: deviceId });
          continue;
        }
        // The row is rendered now, as every row is (ADR 0032 point 5): a payload of a kind, a count and an item id. The row id joins it.
        const rendered = renderNotice(row.kind, row.view, { channel: "push", detail: row.detail, locale: row.locale });
        const payload = rendered.ok
          ? pushPayloadSchema.safeParse({ ...(JSON.parse(rendered.message.text) as object), id: row.id })
          : null;
        if (!rendered.ok || payload === null || !payload.success) {
          await fail(row, "bad_view");
          outboxLog.error("outbox_bad_view", { kind: row.kind });
          continue;
        }
        const text = JSON.stringify(payload.data);

        sentPerUser.set(userKey, sentCount + 1);
        posted = true;
        const result: PushResult = await sendWebPush(
          secret.target,
          Buffer.from(text, "utf8"),
          {
            // A row held by quiet hours must not live a full day at the push service: the message ends when the row would.
            ttl: Math.max(0, PUSH_TTL_SECONDS - Math.floor((now.getTime() - row.createdAt.getTime()) / 1000)),
            urgency: noticeGroupOf(row.kind) === "updates" ? "normal" : "high",
            topic: pushTopicOf(row.id),
          },
          { fetch: deps.fetch, now: deps.now, keys }
        );
        switch (result.kind) {
          case "sent": {
            const markSent = async (trx: Transaction<DB>): Promise<void> => {
              const ok = await markOutboxSent(trx, ctx, row.id, row.lockedAt, {
                messageId: null,
                at: now,
                message: { text, buttons: [] },
              });
              if (!ok) outboxLog.warn("outbox_claim_lost");
              await markPushSuccess(trx, ctx, deviceId, now);
            };
            await inTransaction(markSent);
            outboxLog.info("push_sent", { kind: row.kind, push_subscription_id: deviceId });
            break;
          }
          case "gone":
            // The push service says the browser dropped the subscription (404, 410). The device goes and every open row of it ends
            // `no_device`, this one included. Not a failure of ours: the operator counts leave `no_device` out, so this line is the trace.
            await inTransaction((trx) => removeDevice(trx, ctx, deviceId));
            await endNoDevice(row);
            outboxLog.warn("push_device_gone", {
              kind: row.kind,
              push_subscription_id: deviceId,
              code: "endpoint_gone",
            });
            break;
          case "retry": {
            const wait = result.afterMs ?? backoff(attempts + 1);
            await guarded(() => markPushError(db, ctx, deviceId, "push_retry"), row.id);
            if (attempts + 1 >= MAX_OTHER_ERRORS) {
              await fail(row, "too_many_errors");
            } else {
              await release(row, new Date(now.getTime() + wait), true);
            }
            outboxLog.warn("push_failed", {
              kind: row.kind,
              push_subscription_id: deviceId,
              code: "retry",
              wait_ms: wait,
            });
            break;
          }
          case "refused": {
            // A 4xx that is not a gone device (a rejected VAPID token, a payload that is too large), or a refusal before any request
            // (status 0). The device stays; its last error shows in the device list.
            await guarded(
              () => markPushError(db, ctx, deviceId, result.status > 0 ? `http_${result.status}` : "push_not_sent"),
              row.id
            );
            await fail(row, "push_refused");
            outboxLog.error("push_failed", {
              kind: row.kind,
              push_subscription_id: deviceId,
              code: "refused",
              http_status: result.status,
            });
            break;
          }
        }
      } catch (error) {
        if (error instanceof CryptoKeyVersionError) {
          // The key of the server is not the one that sealed the device: nothing can go out until the key is back. No device is
          // removed. The row and the rest of the run wait.
          const next = new Date(now.getTime() + CONFIG_PAUSE_MS);
          await release(row, next, false);
          await releaseAll(later, next);
          pausedUntil = next;
          outboxLog.error("push_key_version_mismatch");
          return;
        }
        // A database error. After the send the row stays `sending`: the next claim after 5 min sends it again.
        if (!posted) await release(row, new Date(now.getTime() + backoff(row.attempts + 1)), true);
        outboxLog.error("outbox_failed", { ...errorFields(error) });
      }
    }
  }

  return { run };
}
