// Shared set-up of the push reader tests (`push-readers.test.ts`, `push-fallback.test.ts`): an organization with a synced mailbox, members with
// a chat and a device, a waiting approval. Every test runs in a transaction that is rolled back.
import { randomBytes, randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { sql, type Transaction } from "kysely";

import { detectNotices } from "../../src/modules/channels";
import { upsertPushSubscription } from "../../src/modules/channels/push";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";
import { newReceiver } from "../push-decrypt";

import {
  createOrgWithMailbox,
  insertDraftAndSend,
  insertTriaged,
  isolateChannels,
  linkChat,
  randomChatId,
} from "./fixtures";

export const T = new Date("2026-11-20T10:00:00Z");
export const at = (ms: number) => new Date(T.getTime() + ms);
export const pushBox = createSecretBox(randomBytes(32).toString("base64"), 1);

export interface World {
  ctx: TenantContext;
  orgId: string;
  mailboxId: string;
  owner: string;
}

// One organization with a synced mailbox and one owner. No chat link and no device: each test adds what it needs.
export async function world(trx: Transaction<DB>, flag = true): Promise<World> {
  await isolateChannels(trx);
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await markSynced(trx, ctx, created.mailboxId, at(-5 * MINUTE_MS));
  await trx
    .updateTable("mailboxes")
    .set({ status_changed_at: at(-2 * HOUR_MS) })
    .where("id", "=", created.mailboxId)
    .execute();
  if (flag) await setOrgFeature(trx, ctx, { flag: "web_push", enabled: true, actor: "cli", now: T });
  return { ctx, orgId: created.orgId, mailboxId: created.mailboxId, owner: created.userId };
}

export const chat = (trx: Transaction<DB>, w: World, userId: string, linkedAt = at(-2 * HOUR_MS)) =>
  linkChat(trx, w.ctx, userId, randomChatId(), linkedAt);

let counter = 0;
// One device of a user, created at `createdAt`, bound to a session that ends at `sessionEnd` (the session starts at `createdAt` too).
export async function device(
  trx: Transaction<DB>,
  w: World,
  userId: string,
  createdAt: Date,
  sessionEnd = at(DAY_MS)
): Promise<{ id: string; sessionId: string }> {
  counter += 1;
  const receiver = newReceiver();
  const { rows } = await sql<{ id: string }>`
    insert into auth_sessions (user_id, token, expires_at, created_at)
    values (${userId}::uuid, ${randomUUID()}, ${sessionEnd}, ${createdAt}) returning id`.execute(trx);
  const sessionId = rows[0]?.id ?? "";
  const added = await upsertPushSubscription(trx, w.ctx, {
    userId,
    sessionId,
    endpoint: `https://fcm.googleapis.com/fcm/send/readers-${counter}-${randomUUID()}`,
    // Real keys: the sender encrypts the body for this device before it posts.
    p256dh: receiver.sub.p256dh,
    auth: receiver.sub.auth,
    deviceLabel: "Phone",
    box: pushBox,
    now: createdAt,
  });
  return { id: added?.id ?? "", sessionId };
}

export async function setRoutes(trx: Transaction<DB>, w: World, userId: string, routes: Record<string, string>) {
  await trx
    .updateTable("memberships")
    .set({ notice_routes: JSON.stringify(routes) })
    .where("org_id", "=", w.orgId)
    .where("user_id", "=", userId)
    .execute();
}

// One tick of the notice detectors at `now`.
export async function run(trx: Transaction<DB>, now: Date = T): Promise<void> {
  await detectNotices({ db: trx, now: () => now, startedAt: at(-HOUR_MS), testMail: NO_TEST_SENDERS });
}

export async function outbox(trx: Transaction<DB>, orgId: string, kind?: string) {
  let query = trx
    .selectFrom("outbox")
    .select([
      "id",
      "user_id",
      "kind",
      "dedup_key",
      "channel",
      "status",
      "error_code",
      "push_subscription_id",
      "loop_id",
      "email_id",
      "created_at",
      "next_attempt_at",
    ])
    .where("org_id", "=", orgId)
    .orderBy("dedup_key")
    .orderBy("id");
  if (kind !== undefined) query = query.where("kind", "=", kind);
  return query.execute();
}

export const shape = (rows: { dedup_key: string; channel: string }[]) =>
  rows.map((row) => `${row.channel} ${row.dedup_key}`).sort();

export const urgentMail = (trx: Transaction<DB>, w: World, triagedAt: Date): Promise<string> =>
  insertTriaged(trx, w.ctx, w.mailboxId, { category: "urgent", createdAt: triagedAt });

// A send that waits for an answer (a delegation draft), updated at `updatedAt`.
export async function waitingSend(trx: Transaction<DB>, w: World, updatedAt: Date) {
  const pair = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
    createdAt: at(-30 * MINUTE_MS),
    draftProviderResult: { folder: "Drafts", uid: 1 },
    subject: "Quarterly offer",
    from: "boss@example.test",
    bodyText: "Body",
    delegateName: "Anna Nowak",
    task: "Prepare the offer",
  });
  await trx.updateTable("actions").set({ updated_at: updatedAt }).where("id", "=", pair.sendId).execute();
  return pair;
}

export async function setStatus(trx: Transaction<DB>, id: string, status: string, errorCode: string | null = null) {
  await trx
    .updateTable("outbox")
    .set({
      status,
      error_code: errorCode,
      ...(status === "sent" ? { sent_at: T } : {}),
      ...(status === "sending" ? { locked_at: T } : {}),
    })
    .where("id", "=", id)
    .execute();
}
