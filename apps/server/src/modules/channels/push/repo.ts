import { createHash, randomUUID } from "node:crypto";

import { sql, type Transaction } from "kysely";

import type { SecretBox } from "../../../platform/crypto";
import type { DB, TenantContext } from "../../../platform/db";
import { errorFields } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import type { DbOrTrx } from "../repo/shared";

import type { PushTarget } from "./send";

// The push devices of the members. One row per browser. The endpoint and the keys live only inside `secret`
// (the ADR 0009 box, AAD `push:<id>`): no query here selects them except `loadDeviceSecret`, and no log line or error
// carries them. Every query filters by `org_id` of the `TenantContext`.

const log = createLog("channels");

/** A user keeps at most this many devices; the next subscribe removes the oldest first. */
export const MAX_DEVICES_PER_USER = 10;

/** The device key of the dedup of a push row: the Telegram key of the event, the word `push` and the device id. */
export function pushDedupKey(key: string, subscriptionId: string): string {
  return `${key}:push:${subscriptionId}`;
}

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex");
}

const aadOf = (id: string): string => `push:${id}`;

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

// An existing `(user, endpoint)` gets the new session, keys and label (re-bind; `created` false). With `rebindOnly` and no such
// device: null, nothing stored. A new device beyond the cap removes the oldest of the user first, which fails its open rows.
export async function upsertPushSubscription(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: UpsertPushSubscription
): Promise<{ id: string; created: boolean } | null> {
  await lockPushUser(trx, input.userId);
  const hash = endpointHash(input.endpoint);
  const secretOf = (id: string) =>
    input.box.encrypt(JSON.stringify({ endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth }), aadOf(id));

  const existing = await trx
    .selectFrom("push_subscriptions")
    .select("id")
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
    return { id: existing.id, created: false };
  }
  if (input.rebindOnly) return null;

  const own = await trx
    .selectFrom("push_subscriptions")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", input.userId)
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
  return { id, created: true };
}

// The devices that the sender and the fan-out may use: bound to a session that exists and has not expired. No secret,
// no box. Oldest first.
export async function listLiveDeviceIds(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string,
  now: Date
): Promise<{ id: string; createdAt: Date }[]> {
  const rows = await db
    .selectFrom("push_subscriptions")
    .innerJoin("auth_sessions", (join) =>
      join
        .onRef("auth_sessions.id", "=", "push_subscriptions.session_id")
        .onRef("auth_sessions.user_id", "=", "push_subscriptions.user_id")
    )
    .select(["push_subscriptions.id", "push_subscriptions.created_at"])
    .where("push_subscriptions.org_id", "=", ctx.orgId)
    .where("push_subscriptions.user_id", "=", userId)
    .where("auth_sessions.expires_at", ">", now)
    .orderBy("push_subscriptions.created_at")
    .orderBy("push_subscriptions.id")
    .execute();
  return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
}

export interface DeviceView {
  id: string;
  /** The live session of the device (the join keeps only a session that exists). */
  sessionId: string;
  deviceLabel: string;
  createdAt: Date;
  lastSuccessAt: Date | null;
  lastErrorCode: string | null;
}

// The live devices of a user for the panel: label, times and the last error code, no secret. Oldest first.
export async function listDeviceViews(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string,
  now: Date
): Promise<DeviceView[]> {
  const rows = await db
    .selectFrom("push_subscriptions")
    .innerJoin("auth_sessions", (join) =>
      join
        .onRef("auth_sessions.id", "=", "push_subscriptions.session_id")
        .onRef("auth_sessions.user_id", "=", "push_subscriptions.user_id")
    )
    .select([
      "push_subscriptions.id",
      "push_subscriptions.session_id",
      "push_subscriptions.device_label",
      "push_subscriptions.created_at",
      "push_subscriptions.last_success_at",
      "push_subscriptions.last_error_code",
    ])
    .where("push_subscriptions.org_id", "=", ctx.orgId)
    .where("push_subscriptions.user_id", "=", userId)
    .where("auth_sessions.expires_at", ">", now)
    .orderBy("push_subscriptions.created_at")
    .orderBy("push_subscriptions.id")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id ?? "",
    deviceLabel: row.device_label,
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at,
    lastErrorCode: row.last_error_code,
  }));
}

export interface DeviceSecret {
  userId: string;
  /** null: the session of the device ended (the device is not live). */
  sessionId: string | null;
  target: PushTarget;
}

// The decrypted endpoint and keys of one device, for the sender only. null when the device does not exist, or when its secret
// does not open (a wrong key, a changed row): then the device goes (`removeDevice`) and the line logs the device id only.
export async function loadDeviceSecret(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  box: SecretBox
): Promise<DeviceSecret | null> {
  const row = await trx
    .selectFrom("push_subscriptions")
    .select(["user_id", "session_id", "secret", "key_version"])
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  try {
    const plain: unknown = JSON.parse(box.decrypt({ ciphertext: row.secret, keyVersion: row.key_version }, aadOf(id)));
    if (typeof plain !== "object" || plain === null) throw new TypeError("push secret is not an object");
    const { endpoint, p256dh, auth } = plain as Record<string, unknown>;
    if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
      throw new TypeError("push secret has no endpoint or keys");
    }
    return { userId: row.user_id, sessionId: row.session_id, target: { endpoint, p256dh, auth } };
  } catch (error) {
    log.warn("push_secret_unreadable", { push_subscription_id: id, ...errorFields(error) });
    await removeDevice(trx, ctx, id);
    return null;
  }
}

// The device goes. Its `pending` and `sending` push rows end `failed` / `no_device` first; its `sent` and `failed` rows stay as
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
  await trx
    .updateTable("outbox")
    .set({ status: "failed", error_code: "no_device", locked_at: null })
    .where("org_id", "=", ctx.orgId)
    .where("channel", "=", "push")
    .where("push_subscription_id", "=", id)
    .where("status", "in", ["pending", "sending"])
    .execute();
  const result = await trx
    .deleteFrom("push_subscriptions")
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .executeTakeFirst();
  return Number(result.numDeletedRows) === 1;
}

export async function markPushSuccess(db: DbOrTrx, ctx: TenantContext, id: string, now: Date): Promise<void> {
  await db
    .updateTable("push_subscriptions")
    .set({ last_success_at: now, last_error_code: null })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .execute();
}

/** `code` is a short code (`^[a-z0-9_]{1,40}$`, a CHECK constraint), never an error text or a URL. */
export async function markPushError(db: DbOrTrx, ctx: TenantContext, id: string, code: string): Promise<void> {
  await db
    .updateTable("push_subscriptions")
    .set({ last_error_code: code })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .execute();
}
