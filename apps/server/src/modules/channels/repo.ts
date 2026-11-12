import { membershipRoleSchema, outButtonsSchema, type OutButton, type OutMessage } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";

import type { LinkedChat } from "./port";

type DbOrTrx = Db | Transaction<DB>;

const CHANNEL = "telegram";

function selectLinkedChats(db: DbOrTrx) {
  return db
    .selectFrom("chat_links")
    .innerJoin("memberships", (join) =>
      join.onRef("memberships.org_id", "=", "chat_links.org_id").onRef("memberships.user_id", "=", "chat_links.user_id")
    )
    .select([
      "chat_links.org_id",
      "chat_links.user_id",
      "chat_links.external_chat_id",
      "chat_links.linked_at",
      "memberships.role",
    ])
    .where("chat_links.channel", "=", CHANNEL);
}

function toLinkedChat(row: {
  org_id: string;
  user_id: string;
  external_chat_id: string;
  linked_at: Date;
  role: string;
}): LinkedChat {
  return {
    orgId: row.org_id,
    userId: row.user_id,
    role: membershipRoleSchema.parse(row.role),
    // bigint comes back as a string; a chat id has at most 52 bits, so Number is exact.
    chatId: Number(row.external_chat_id),
    linkedAt: row.linked_at,
  };
}

export async function insertLinkToken(
  db: DbOrTrx,
  ctx: TenantContext,
  row: { tokenHash: string; userId: string; expiresAt: Date; createdAt: Date }
): Promise<void> {
  await db
    .insertInto("chat_link_tokens")
    .values({
      token_hash: row.tokenHash,
      org_id: ctx.orgId,
      user_id: row.userId,
      expires_at: row.expiresAt,
      created_at: row.createdAt,
    })
    .execute();
}

// Deletes the unused tokens of the user, and every token of the user created before `createdBefore`.
export async function deleteOldTokens(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string,
  createdBefore: Date
): Promise<number> {
  const result = await db
    .deleteFrom("chat_link_tokens")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where((eb) => eb.or([eb("used_at", "is", null), eb("created_at", "<", createdBefore)]))
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

// Entry point (D18): the token is the only input, so the organization comes from the row.
export async function useLinkToken(
  trx: Transaction<DB>,
  tokenHash: string,
  now: Date
): Promise<{ orgId: string; userId: string } | undefined> {
  const row = await trx
    .updateTable("chat_link_tokens")
    .set({ used_at: now })
    .where("token_hash", "=", tokenHash)
    .where("used_at", "is", null)
    .where("expires_at", ">", now)
    .returning(["org_id", "user_id"])
    .executeTakeFirst();
  return row ? { orgId: row.org_id, userId: row.user_id } : undefined;
}

// Entry point (D18).
export async function findLinkToken(
  db: DbOrTrx,
  tokenHash: string
): Promise<{ usedAt: Date | null; expiresAt: Date } | undefined> {
  const row = await db
    .selectFrom("chat_link_tokens")
    .select(["used_at", "expires_at"])
    .where("token_hash", "=", tokenHash)
    .executeTakeFirst();
  return row ? { usedAt: row.used_at, expiresAt: row.expires_at } : undefined;
}

// D18: the chat moves to the token's member, so the link of this chat in any organization goes first.
// Returns the links of other members that this call removed, so the caller can audit them.
export async function replaceChatLink(
  trx: Transaction<DB>,
  ctx: TenantContext,
  row: { userId: string; chatId: number; linkedAt: Date }
): Promise<{ orgId: string; userId: string }[]> {
  const moved = await trx
    .deleteFrom("chat_links")
    .where("channel", "=", CHANNEL)
    .where("external_chat_id", "=", String(row.chatId))
    .returning(["org_id", "user_id"])
    .execute();
  await trx
    .deleteFrom("chat_links")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", row.userId)
    .where("channel", "=", CHANNEL)
    .execute();
  await trx
    .insertInto("chat_links")
    .values({
      org_id: ctx.orgId,
      user_id: row.userId,
      channel: CHANNEL,
      external_chat_id: row.chatId,
      linked_at: row.linkedAt,
    })
    .execute();
  return moved
    .filter((link) => link.org_id !== ctx.orgId || link.user_id !== row.userId)
    .map((link) => ({ orgId: link.org_id, userId: link.user_id }));
}

// Entry point (D18): an update brings only the chat id.
export async function findChatLink(db: DbOrTrx, chatId: number): Promise<LinkedChat | undefined> {
  const row = await selectLinkedChats(db).where("chat_links.external_chat_id", "=", String(chatId)).executeTakeFirst();
  return row ? toLinkedChat(row) : undefined;
}

// Scheduler entry point (D18): it walks all organizations.
// A `suspended` organization is skipped unless `includeSuspended` (D4: no notice and no digest for it).
export async function listLinkedChats(db: DbOrTrx, opts: { includeSuspended: boolean }): Promise<LinkedChat[]> {
  let query = selectLinkedChats(db);
  if (!opts.includeSuspended) {
    query = query
      .innerJoin("organizations", "organizations.id", "chat_links.org_id")
      .where("organizations.plan", "<>", "suspended");
  }
  const rows = await query.orderBy("chat_links.org_id").orderBy("chat_links.user_id").execute();
  return rows.map(toLinkedChat);
}

// The linked chats of one organization, for the notices of a web action (the tenant filter is the org id).
export async function listLinkedChatsOfOrg(db: DbOrTrx, ctx: TenantContext): Promise<LinkedChat[]> {
  const rows = await selectLinkedChats(db)
    .where("chat_links.org_id", "=", ctx.orgId)
    .orderBy("chat_links.user_id")
    .execute();
  return rows.map(toLinkedChat);
}

export async function getChatLinkForUser(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string
): Promise<LinkedChat | undefined> {
  const row = await selectLinkedChats(db)
    .where("chat_links.org_id", "=", ctx.orgId)
    .where("chat_links.user_id", "=", userId)
    .executeTakeFirst();
  return row ? toLinkedChat(row) : undefined;
}

export async function deleteChatLinks(db: DbOrTrx, ctx: TenantContext, userId: string): Promise<number> {
  const result = await db
    .deleteFrom("chat_links")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("channel", "=", CHANNEL)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

export const outboxKinds = [
  "digest",
  "urgent",
  "auth_error",
  "sync_stale",
  "sync_ok",
  "action_failed",
  "approval",
  "approval_set",
  "send_result",
  "delegation_answered",
  "mailbox_removed",
] as const;
export type OutboxKind = (typeof outboxKinds)[number];
const outboxKindSchema = z.enum(outboxKinds);

export const outboxFailCodes = ["blocked", "bad_request", "expired", "no_chat", "outdated", "too_many_errors"] as const;
export type OutboxFailCode = (typeof outboxFailCodes)[number];

export interface NewOutboxRow {
  userId: string;
  kind: OutboxKind;
  dedupKey: string;
  emailId?: string;
  mailboxId?: string;
  digestId?: string;
  message: OutMessage;
  createdAt: Date;
  nextAttemptAt: Date;
}

// null = the event has a row already (D4: exactly one row per event).
export async function insertOutbox(db: DbOrTrx, ctx: TenantContext, row: NewOutboxRow): Promise<string | null> {
  // A row with bad buttons must not enter the outbox: claimDueOutbox parses them and would fail on it every run.
  const buttons = outButtonsSchema.parse(row.message.buttons);
  const inserted = await db
    .insertInto("outbox")
    .values({
      org_id: ctx.orgId,
      user_id: row.userId,
      kind: row.kind,
      dedup_key: row.dedupKey,
      email_id: row.emailId ?? null,
      mailbox_id: row.mailboxId ?? null,
      digest_id: row.digestId ?? null,
      text: row.message.text,
      buttons: JSON.stringify(buttons),
      status: "pending",
      attempts: 0,
      created_at: row.createdAt,
      next_attempt_at: row.nextAttemptAt,
    })
    .onConflict((oc) => oc.columns(["org_id", "user_id", "dedup_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  return inserted?.id ?? null;
}

// The text of the message that was queued for this user; the tap handlers edit it. Tenant and user filter the row.
export async function findOutboxByDedup(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string,
  dedupKey: string
): Promise<{ id: string; text: string } | undefined> {
  return db
    .selectFrom("outbox")
    .select(["id", "text"])
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("dedup_key", "=", dedupKey)
    .executeTakeFirst();
}

export interface ClaimedOutbox {
  id: string;
  orgId: string;
  userId: string;
  kind: OutboxKind;
  text: string;
  buttons: OutButton[][];
  attempts: number;
  lockedAt: Date;
  createdAt: Date;
  digestId: string | null;
  wasStale: boolean;
}

// Scheduler entry point (D18): it walks all organizations. `orgIds` is for tests only.
// `lockedAt` is the JS `now` value; it is the token for markOutboxSent, releaseOutbox and failOutbox, so it must survive
// the round trip exactly. The claim does not change `attempts`.
export async function claimDueOutbox(
  db: DbOrTrx,
  opts: { now: Date; limit: number; staleBefore: Date; orgIds?: readonly string[] }
): Promise<ClaimedOutbox[]> {
  const { orgIds } = opts;
  // An empty list means no org, not all orgs.
  if (orgIds && orgIds.length === 0) return [];
  const rows = await db
    .with("picked", (qb) => {
      let query = qb
        .selectFrom("outbox")
        .select((eb) => ["id", eb("status", "=", "sending").as("was_stale")])
        .where((eb) =>
          eb.or([
            eb.and([eb("status", "=", "pending"), eb("next_attempt_at", "<=", opts.now)]),
            eb.and([eb("status", "=", "sending"), eb("locked_at", "<", opts.staleBefore)]),
          ])
        )
        // D4: a suspended organization gets no message, approval requests included; its rows wait (A12, A17).
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("organizations")
                .select("organizations.id")
                .whereRef("organizations.id", "=", "outbox.org_id")
                .where("organizations.plan", "=", "suspended")
            )
          )
        );
      if (orgIds) query = query.where("org_id", "in", orgIds);
      return query.orderBy("created_at").orderBy("id").limit(opts.limit).forUpdate().skipLocked();
    })
    .updateTable("outbox as o")
    .set({ status: "sending", locked_at: opts.now })
    .from("picked")
    .whereRef("o.id", "=", "picked.id")
    .returning([
      "o.id",
      "o.org_id",
      "o.user_id",
      "o.kind",
      "o.text",
      "o.buttons",
      "o.attempts",
      "o.locked_at",
      "o.created_at",
      "o.digest_id",
      "picked.was_stale",
    ])
    .execute();
  return rows
    .map((row) => ({
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      kind: outboxKindSchema.parse(row.kind),
      text: row.text,
      buttons: outButtonsSchema.parse(row.buttons),
      attempts: row.attempts,
      lockedAt: row.locked_at ?? opts.now,
      createdAt: row.created_at,
      digestId: row.digest_id,
      wasStale: Boolean(row.was_stale),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function markOutboxSent(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  sent: { messageId: number; at: Date }
): Promise<boolean> {
  const result = await db
    .updateTable("outbox")
    .set({
      status: "sent",
      sent_at: sent.at,
      external_message_id: sent.messageId,
      locked_at: null,
      error_code: null,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .where("status", "=", "sending")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

export async function releaseOutbox(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  opts: { nextAttemptAt: Date; countAttempt: boolean }
): Promise<boolean> {
  const result = await db
    .updateTable("outbox")
    .set((eb) => ({
      status: "pending",
      locked_at: null,
      next_attempt_at: opts.nextAttemptAt,
      attempts: opts.countAttempt ? eb("attempts", "+", 1) : eb.ref("attempts"),
    }))
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .where("status", "=", "sending")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

export async function failOutbox(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  code: OutboxFailCode
): Promise<boolean> {
  const result = await db
    .updateTable("outbox")
    .set({ status: "failed", locked_at: null, error_code: code })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .where("status", "=", "sending")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

// Only `pending` rows: a row in flight finishes.
export async function cancelPendingOutbox(
  db: DbOrTrx,
  ctx: TenantContext,
  filter: { kind: "auth_error" | "sync_stale"; mailboxId: string; exceptDedupKey?: string }
): Promise<number> {
  let query = db
    .updateTable("outbox")
    .set({ status: "failed", error_code: "outdated" })
    .where("org_id", "=", ctx.orgId)
    .where("kind", "=", filter.kind)
    .where("mailbox_id", "=", filter.mailboxId)
    .where("status", "=", "pending");
  if (filter.exceptDedupKey !== undefined) query = query.where("dedup_key", "<>", filter.exceptDedupKey);
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows);
}

// The suspend hook: queued messages of the organization never go out. `sending` rows finish.
// Approval requests stay `pending`: the notifier queues them once, so a cancelled request would time out unseen.
// They wait for a resume (the sender does not claim them while suspended). At the resume, the sends whose request no owner
// saw end as `not_seen` and their requests are cancelled (F079, `cancelPendingApprovalRequestsOfClosedSends`).
export async function cancelPendingOutboxOfOrg(db: DbOrTrx, ctx: TenantContext): Promise<number> {
  const result = await db
    .updateTable("outbox")
    .set({ status: "failed", error_code: "outdated", locked_at: null })
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "pending")
    .where("kind", "not in", ["approval", "approval_set"])
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

// F079: the resume hook. An approval request whose send no longer waits never goes out: its buttons would answer "expired".
// A `pending` row, and a `sending` row whose claim is stale (`locked_at` before `staleBefore`: a crash left it, and the
// sender would claim it again), become `failed` / `outdated`. A `sending` row with a fresh claim is in flight: it finishes.
// A request of a send that still waits stays.
export async function cancelPendingApprovalRequestsOfClosedSends(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { staleBefore: Date }
): Promise<number> {
  const result = await sql`
    update outbox set status = 'failed', error_code = 'outdated', locked_at = null
    where org_id = ${ctx.orgId} and kind in ('approval', 'approval_set')
      and (status = 'pending' or (status = 'sending' and locked_at < ${opts.staleBefore}))
      and not exists (
        select 1 from actions a
        where a.org_id = outbox.org_id and a.type = 'send' and a.status = 'awaiting_approval'
          and ((outbox.kind = 'approval' and outbox.dedup_key = 'approval:' || a.id::text)
            or (outbox.kind = 'approval_set' and outbox.dedup_key = 'approval_set:' || (a.payload->>'set_id')))
      )
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}

// Members that got a "sync is late" notice for an episode and no "sync works again" notice yet.
export async function listSentStaleEpisodes(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<{ userId: string; episode: string }[]> {
  const rows = await db
    .selectFrom("outbox as s")
    .select(["s.user_id", sql<string>`split_part(s.dedup_key, ':', 3)`.as("episode")])
    .where("s.org_id", "=", ctx.orgId)
    .where("s.mailbox_id", "=", mailboxId)
    .where("s.kind", "=", "sync_stale")
    .where("s.status", "=", "sent")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("outbox as ok")
            .select("ok.id")
            .whereRef("ok.org_id", "=", "s.org_id")
            .whereRef("ok.user_id", "=", "s.user_id")
            .where(
              sql<boolean>`ok.dedup_key = 'sync_ok:' || s.mailbox_id::text || ':' || split_part(s.dedup_key, ':', 3)`
            )
        )
      )
    )
    .orderBy("s.created_at")
    .execute();
  return rows.map((row) => ({ userId: row.user_id, episode: row.episode }));
}

const RETENTION_BATCH = 1000;

// Retention (A23): the text of an old message goes after the period. Two rules:
// - a `sent` or `failed` row gets the text `[removed]` (its `error_code` stays);
// - a `pending` or `sending` row also becomes `failed` / `expired`: the row of a suspended organization is never claimed,
//   and a message of that age must not go out at a resume.
// Batches by id; a locked row waits for a later day. A repeat call changes nothing.
export async function clearOutboxTexts(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("outbox")
      .set({ text: "[removed]" })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("outbox")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("created_at", "<", opts.before)
          .where("status", "in", ["sent", "failed"])
          .where("text", "<>", "[removed]")
          .orderBy("id")
          .limit(batch)
          .forUpdate()
          .skipLocked()
      )
      .executeTakeFirstOrThrow();
    const changed = Number(result.numUpdatedRows);
    total += changed;
    if (changed === 0) break;
  }
  for (;;) {
    const result = await db
      .updateTable("outbox")
      .set({ status: "failed", error_code: "expired", locked_at: null, text: "[removed]" })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("outbox")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("created_at", "<", opts.before)
          .where("status", "in", ["pending", "sending"])
          .orderBy("id")
          .limit(batch)
          .forUpdate()
          .skipLocked()
      )
      .executeTakeFirstOrThrow();
    const changed = Number(result.numUpdatedRows);
    total += changed;
    if (changed === 0) return total;
  }
}

// Retention (A23): link tokens used or expired before `before` (the caller passes now − 1 d) are deleted.
// The table has no `id`; its key is `token_hash`.
export async function deleteOldLinkTokens(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .deleteFrom("chat_link_tokens")
      .where("org_id", "=", ctx.orgId)
      .where(
        "token_hash",
        "in",
        db
          .selectFrom("chat_link_tokens")
          .select("token_hash")
          .where("org_id", "=", ctx.orgId)
          .where((eb) => eb.or([eb("used_at", "<", opts.before), eb("expires_at", "<", opts.before)]))
          .orderBy("token_hash")
          .limit(batch)
          .forUpdate()
          .skipLocked()
      )
      .executeTakeFirst();
    const changed = Number(result.numDeletedRows);
    total += changed;
    if (changed === 0) return total;
  }
}
