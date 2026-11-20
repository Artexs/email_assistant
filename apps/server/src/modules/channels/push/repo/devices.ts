import { membershipRoleSchema, userLocaleSchema, type MembershipRole, type UserLocale } from "@ea/core";
import type { Transaction } from "kysely";

import { CryptoKeyVersionError, type SecretBox } from "../../../../platform/crypto";
import type { DB, TenantContext } from "../../../../platform/db";
import { errorFields } from "../../../../platform/errors";
import { createLog } from "../../../../platform/log";
import type { DbOrTrx } from "../../repo/shared";
import type { PushTarget } from "../send";

import { aadOf, removeDevice } from "./subscriptions";

// The push devices of the members. One row per browser. The endpoint and the keys live only inside `secret`
// (the ADR 0009 box, AAD `push:<id>`): no query here selects them except `loadDeviceSecret`, and no log line or error
// carries them. Every query filters by `org_id` of the `TenantContext`.

const log = createLog("channels");
// A live device with the time it became reachable. `boundAt` is the later of the device `created_at` and the `created_at` of its
// session: a device that was bound again to a new session after the old one ended is not reachable for the events of the dead time,
// so the fan-out compares the event with `boundAt` and a rebound device gets no burst of old notices.
export interface LiveDevice {
  id: string;
  createdAt: Date;
  boundAt: Date;
}
// The devices that the sender and the fan-out may use: bound to a session that exists and has not expired. No secret,
// no box. Oldest first.
export async function listLiveDeviceIds(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string,
  now: Date
): Promise<LiveDevice[]> {
  const rows = await db
    .selectFrom("push_subscriptions")
    .innerJoin("auth_sessions", (join) =>
      join
        .onRef("auth_sessions.id", "=", "push_subscriptions.session_id")
        .onRef("auth_sessions.user_id", "=", "push_subscriptions.user_id")
    )
    .select([
      "push_subscriptions.id",
      "push_subscriptions.created_at",
      "auth_sessions.created_at as session_created_at",
    ])
    .where("push_subscriptions.org_id", "=", ctx.orgId)
    .where("push_subscriptions.user_id", "=", userId)
    .where("auth_sessions.expires_at", ">", now)
    .orderBy("push_subscriptions.created_at")
    .orderBy("push_subscriptions.id")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    boundAt: row.session_created_at > row.created_at ? row.session_created_at : row.created_at,
  }));
}
// A member who can be reached by push only: a live device and no linked Telegram chat. `since` is the oldest live device.
export interface PushOnlyMember {
  orgId: string;
  userId: string;
  role: MembershipRole;
  locale: UserLocale;
  since: Date;
}
// The push-only members of the organizations that are not suspended (`orgId` narrows to one). It reads no flag: the caller
// asks `isFeatureOn(web_push)` for each organization. Oldest first by organization and user.
export async function listPushOnlyMembers(db: DbOrTrx, opts: { now: Date; orgId?: string }): Promise<PushOnlyMember[]> {
  let query = db
    .selectFrom("push_subscriptions as p")
    .innerJoin("auth_sessions as s", (join) =>
      join.onRef("s.id", "=", "p.session_id").onRef("s.user_id", "=", "p.user_id")
    )
    .innerJoin("memberships as m", (join) =>
      join.onRef("m.org_id", "=", "p.org_id").onRef("m.user_id", "=", "p.user_id")
    )
    .innerJoin("users as u", "u.id", "p.user_id")
    .innerJoin("organizations as o", "o.id", "p.org_id")
    .select(["p.org_id", "p.user_id", "m.role", "u.locale"])
    .select((eb) => eb.fn.min("p.created_at").as("since"))
    .where("s.expires_at", ">", opts.now)
    .where("o.plan", "<>", "suspended")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("chat_links as c")
            .select("c.user_id")
            .whereRef("c.org_id", "=", "p.org_id")
            .whereRef("c.user_id", "=", "p.user_id")
            .where("c.channel", "=", "telegram")
        )
      )
    )
    .groupBy(["p.org_id", "p.user_id", "m.role", "u.locale"]);
  if (opts.orgId !== undefined) query = query.where("p.org_id", "=", opts.orgId);
  const rows = await query.orderBy("p.org_id").orderBy("p.user_id").execute();
  return rows.flatMap((row) =>
    row.since === null
      ? []
      : [
          {
            orgId: row.org_id,
            userId: row.user_id,
            role: membershipRoleSchema.parse(row.role),
            // A user without a locale gets Polish, as the other notices do.
            locale: userLocaleSchema.nullable().parse(row.locale) ?? "pl",
            since: row.since,
          },
        ]
  );
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
// does not open (a wrong key, a changed row): then the device goes (`removeDevice`) and the line logs the device id only. A secret
// of another key VERSION throws `CryptoKeyVersionError` and removes nothing: the server key was changed, and a key change drops no device.
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
    // Another key version is a configuration problem (the key of the server changed): the device is not damaged, so it stays and
    // the caller decides (the sender raises an alert and keeps the row).
    if (error instanceof CryptoKeyVersionError) throw error;
    log.warn("push_secret_unreadable", { push_subscription_id: id, ...errorFields(error) });
    await removeDevice(trx, ctx, id);
    return null;
  }
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
