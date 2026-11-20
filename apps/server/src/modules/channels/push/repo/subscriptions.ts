import { createHash, randomUUID } from "node:crypto";

import { sql, type Transaction } from "kysely";

import type { SecretBox } from "../../../../platform/crypto";
import { pushDedupKey, type DB, type TenantContext } from "../../../../platform/db";
import type { OutboxKind } from "../../repo";
import { queueTelegramFallback } from "../fallback";

/** A user keeps at most this many devices; the next subscribe removes a dead device first, else the oldest. */
export const MAX_DEVICES_PER_USER = 10;
// The device key of the dedup of a push row (`<Telegram key>:push:<device id>`); the readers of a Telegram key use `dedupKeyOrPush`.
export { pushDedupKey };
export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex");
}
export const aadOf = (id: string): string => `push:${id}`;
/** The endpoint of a browser that the user already registered in another organization: one device row per user and endpoint. */
export class PushDeviceElsewhereError extends Error {
  constructor() {
    super("The push endpoint is registered for this user in another organization");
    this.name = "PushDeviceElsewhereError";
  }
}
export interface UpsertPushSubscription {
  userId: string;
  /** The web session that makes the device live. */
  sessionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string;
  box: SecretBox;
  now: Date;
  /** A page load: re-bind a device of this user that exists; store nothing new. */
  rebindOnly?: boolean;
}
// One transaction at a time per user. The lock is held to the end of the transaction. Two subscribes of one user would otherwise both pass
// the `select` below before either commits: the same endpoint twice would end in a unique-key conflict that looks like another
// organization (`PushDeviceElsewhereError`), and two new devices at 9 would leave 11. The key holds the user only: the unique key
// `(user_id, endpoint_hash)` spans organizations.
export async function lockPushUser(trx: Transaction<DB>, userId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push:${userId}`}, 0))`.execute(trx);
}
// An existing `(user, endpoint)` gets the new session, keys and label (re-bind; `created` false). `sessionChanged` is true when
// the device is new or was bound to another session (or none): a page load of the same session changes no binding. With
// `rebindOnly` and no such device: null, nothing stored. A new device beyond the cap removes a device of the user first (a dead one before a live one,
// then the oldest), which fails its open rows.
export async function upsertPushSubscription(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: UpsertPushSubscription
): Promise<{ id: string; created: boolean; sessionChanged: boolean } | null> {
  await lockPushUser(trx, input.userId);
  const hash = endpointHash(input.endpoint);
  const secretOf = (id: string) =>
    input.box.encrypt(JSON.stringify({ endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth }), aadOf(id));

  const existing = await trx
    .selectFrom("push_subscriptions")
    .select(["id", "session_id"])
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", input.userId)
    .where("endpoint_hash", "=", hash)
    .forUpdate()
    .executeTakeFirst();
  if (existing) {
    const secret = secretOf(existing.id);
    await trx
      .updateTable("push_subscriptions")
      .set({
        session_id: input.sessionId,
        secret: secret.ciphertext,
        key_version: secret.keyVersion,
        device_label: input.deviceLabel,
      })
      .where("org_id", "=", ctx.orgId)
      .where("id", "=", existing.id)
      .execute();
    return { id: existing.id, created: false, sessionChanged: existing.session_id !== input.sessionId };
  }
  if (input.rebindOnly) return null;

  // Devices that are not live (no session, or an expired one) go first, oldest first; a live device goes last. A live
  // device is the one that the user can still receive on, so a full list drops the dead ones before it drops a working phone.
  const own = await trx
    .selectFrom("push_subscriptions")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", input.userId)
    .orderBy(
      sql`(session_id is not null and exists (
        select 1 from auth_sessions s where s.id = push_subscriptions.session_id and s.expires_at > ${input.now}
      ))`
    )
    .orderBy("created_at")
    .orderBy("id")
    .forUpdate()
    .execute();
  const surplus = own.length - (MAX_DEVICES_PER_USER - 1);
  for (const row of own.slice(0, Math.max(0, surplus))) await removeDevice(trx, ctx, row.id);

  const id = randomUUID();
  const secret = secretOf(id);
  const inserted = await trx
    .insertInto("push_subscriptions")
    .values({
      id,
      org_id: ctx.orgId,
      user_id: input.userId,
      session_id: input.sessionId,
      secret: secret.ciphertext,
      key_version: secret.keyVersion,
      endpoint_hash: hash,
      device_label: input.deviceLabel,
      created_at: input.now,
    })
    .onConflict((oc) => oc.columns(["user_id", "endpoint_hash"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  // No row came back: the unique key holds a device that this organization cannot see (another organization of the user).
  if (!inserted) throw new PushDeviceElsewhereError();
  return { id, created: true, sessionChanged: true };
}
// The device goes. Its `pending` and `sending` push rows end `failed` / `no_device` first (each may fall back to Telegram); its `sent` and `failed` rows stay as
// history (the key clears only the device column). With `userId`, only a device of that user goes. True when a device was deleted.
export async function removeDevice(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  opts?: { userId?: string }
): Promise<boolean> {
  let device = trx.selectFrom("push_subscriptions").select("id").where("org_id", "=", ctx.orgId).where("id", "=", id);
  if (opts?.userId !== undefined) device = device.where("user_id", "=", opts.userId);
  const found = await device.forUpdate().executeTakeFirst();
  if (!found) return false;
  const ended = await trx
    .updateTable("outbox")
    .set({ status: "failed", error_code: "no_device", locked_at: null })
    .where("org_id", "=", ctx.orgId)
    .where("channel", "=", "push")
    .where("push_subscription_id", "=", id)
    .where("status", "in", ["pending", "sending"])
    .returning([
      "id",
      "user_id",
      "kind",
      "dedup_key",
      "view",
      "locale",
      "mailbox_id",
      "email_id",
      "loop_id",
      "created_at",
    ])
    .execute();
  // A row that ends `no_device` falls back to Telegram when the member can get it there (`queueTelegramFallback`).
  for (const row of ended) {
    await queueTelegramFallback(trx, ctx, {
      id: row.id,
      userId: row.user_id,
      kind: row.kind as OutboxKind,
      dedupKey: row.dedup_key,
      view: row.view,
      locale: row.locale,
      mailboxId: row.mailbox_id,
      emailId: row.email_id,
      loopId: row.loop_id,
      createdAt: row.created_at,
    });
  }
  const result = await trx
    .deleteFrom("push_subscriptions")
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .executeTakeFirst();
  return Number(result.numDeletedRows) === 1;
}
