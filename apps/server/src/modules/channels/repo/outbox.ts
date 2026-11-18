import {
  noticeChannels,
  noticeDetails,
  noticeKindSchema,
  noticeKinds,
  outButtonsSchema,
  userLocaleSchema,
  type NoticeChannel,
  type NoticeDetail,
  type NoticeKind,
  type OutButton,
  type OutMessage,
  type UserLocale,
} from "@ea/core";
import { z } from "zod";

import type { TenantContext } from "../../../platform/db";

import { releaseMarksOfFailedDigests } from "./digest-marks";
import type { DbOrTrx } from "./shared";

// The text of a `sent` or `failed` row after retention; the view is `{}` then.
export const OUTBOX_REMOVED_TEXT = "[removed]";
export const outboxKinds = noticeKinds;
export type OutboxKind = NoticeKind;
export const outboxFailCodes = [
  "blocked",
  "bad_request",
  "expired",
  "no_chat",
  "outdated",
  "too_many_errors",
  "bad_view",
  "answered_elsewhere",
  // `approval_edit` rows: the card follows an outcome that the send no longer has, the card is gone, or Telegram refused the edit.
  "stale_edit",
  "no_target",
  "edit_failed",
  // Report mail: the mail server refused the APPEND into the INBOX.
  "append_refused",
] as const;
export type OutboxFailCode = (typeof outboxFailCodes)[number];
export interface NewOutboxRow {
  userId: string;
  kind: OutboxKind;
  dedupKey: string;
  emailId?: string;
  // A card or notice of a follow-up carries its loop instead of a mail (the outbox CHECK takes either).
  loopId?: string;
  mailboxId?: string;
  digestId?: string;
  // Only kind `approval_edit`: the card that the row edits (`outbox_approval_edit_check`).
  editOfOutboxId?: string;
  view: Record<string, unknown>;
  locale: UserLocale;
  // Absent = `telegram`. A `mail` row is the report mail (`mailboxId` names the mailbox it goes into).
  channel?: NoticeChannel;
  createdAt: Date;
  nextAttemptAt: Date;
}
// null = the event has a row already (exactly one row per event).
export async function insertOutbox(db: DbOrTrx, ctx: TenantContext, row: NewOutboxRow): Promise<string | null> {
  const inserted = await db
    .insertInto("outbox")
    .values({
      org_id: ctx.orgId,
      user_id: row.userId,
      kind: row.kind,
      dedup_key: row.dedupKey,
      email_id: row.emailId ?? null,
      loop_id: row.loopId ?? null,
      mailbox_id: row.mailboxId ?? null,
      digest_id: row.digestId ?? null,
      edit_of_outbox_id: row.editOfOutboxId ?? null,
      view: JSON.stringify(row.view),
      locale: row.locale,
      channel: row.channel ?? "telegram",
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
// The mails of one mailbox that got a `not_triaged` notice since `since` (any member, any status): the cap of the
// degraded notice counts mails, not rows.
export async function listNotTriagedEmailIds(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<Set<string>> {
  const rows = await db
    .selectFrom("outbox")
    .select("email_id")
    .distinct()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("kind", "=", "not_triaged")
    .where("created_at", ">=", since)
    .where("email_id", "is not", null)
    .execute();
  return new Set(rows.flatMap((row) => (row.email_id === null ? [] : [row.email_id])));
}
// The text of the message that was queued for this user; the tap handlers edit it. Tenant and user filter the row.
export async function findOutboxByDedup(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string,
  dedupKey: string
): Promise<
  { id: string; text: string | null; channel: NoticeChannel; detail: NoticeDetail; locale: UserLocale } | undefined
> {
  const row = await db
    .selectFrom("outbox")
    .select(["id", "text", "channel", "detail", "locale"])
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("dedup_key", "=", dedupKey)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    id: row.id,
    text: row.text,
    channel: z.enum(noticeChannels).parse(row.channel),
    detail: z.enum(noticeDetails).parse(row.detail),
    locale: userLocaleSchema.parse(row.locale),
  };
}
export interface ClaimedOutbox {
  id: string;
  orgId: string;
  userId: string;
  kind: OutboxKind;
  dedupKey: string;
  view: unknown;
  channel: NoticeChannel;
  // The mailbox of a `mail` row (the report mailbox); null for a row that names none.
  mailboxId: string | null;
  detail: NoticeDetail;
  locale: UserLocale;
  // null: the row holds facts only and the sender renders it (ADR 0032 point 5).
  text: string | null;
  buttons: OutButton[][];
  attempts: number;
  lockedAt: Date;
  createdAt: Date;
  digestId: string | null;
  // Only kind `approval_edit`: the card that the row edits.
  editOfOutboxId: string | null;
  wasStale: boolean;
}
// Scheduler entry point: it walks all organizations. `orgIds` is for tests only.
// One channel per claim, `telegram` by default: the Telegram sender never claims a `mail` row, so it is never sent to a chat; the report mail sender
//  claims `mail` rows only.
// `lockedAt` is the JS `now` value; it is the token for markOutboxSent, releaseOutbox and failOutbox, so it must survive
// the round trip exactly. The claim does not change `attempts`.
export async function claimDueOutbox(
  db: DbOrTrx,
  opts: { now: Date; limit: number; staleBefore: Date; orgIds?: readonly string[]; channel?: NoticeChannel }
): Promise<ClaimedOutbox[]> {
  const { orgIds } = opts;
  // An empty list means no org, not all orgs.
  if (orgIds && orgIds.length === 0) return [];
  const rows = await db
    .with("picked", (qb) => {
      let query = qb
        .selectFrom("outbox")
        .select((eb) => ["id", eb("status", "=", "sending").as("was_stale")])
        .where("channel", "=", opts.channel ?? "telegram")
        .where((eb) =>
          eb.or([
            eb.and([eb("status", "=", "pending"), eb("next_attempt_at", "<=", opts.now)]),
            eb.and([eb("status", "=", "sending"), eb("locked_at", "<", opts.staleBefore)]),
          ])
        )
        // A suspended organization gets no message, approval requests included; its rows wait.
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
      "o.dedup_key",
      "o.view",
      "o.channel",
      "o.mailbox_id",
      "o.detail",
      "o.locale",
      "o.text",
      "o.buttons",
      "o.attempts",
      "o.locked_at",
      "o.created_at",
      "o.digest_id",
      "o.edit_of_outbox_id",
      "picked.was_stale",
    ])
    .execute();
  return rows
    .map((row) => ({
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      kind: noticeKindSchema.parse(row.kind),
      dedupKey: row.dedup_key,
      view: row.view,
      channel: z.enum(noticeChannels).parse(row.channel),
      mailboxId: row.mailbox_id,
      detail: z.enum(noticeDetails).parse(row.detail),
      locale: userLocaleSchema.parse(row.locale),
      text: row.text,
      buttons: outButtonsSchema.parse(row.buttons),
      attempts: row.attempts,
      lockedAt: row.locked_at ?? opts.now,
      createdAt: row.created_at,
      digestId: row.digest_id,
      editOfOutboxId: row.edit_of_outbox_id,
      wasStale: Boolean(row.was_stale),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
// A `mail` row older than `before` (the caller passes now − 24 h) that is still open becomes `failed` / `expired`, as the
// Telegram sender does with its rows. The report mail sender runs this at each tick, so a row that no run could send ends as
// `expired` (a mailbox that stays paused, a sender that is down). Returns the count.
export async function expireOldMailOutbox(db: DbOrTrx, opts: { before: Date }): Promise<number> {
  const result = await db
    .updateTable("outbox")
    .set({ status: "failed", error_code: "expired", locked_at: null })
    .where("channel", "=", "mail")
    .where("status", "in", ["pending", "sending"])
    .where("created_at", "<", opts.before)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}
export async function markOutboxSent(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  // `messageId` is the Telegram message id; a report mail has none (null).
  sent: { messageId: number | null; at: Date; message: OutMessage }
): Promise<boolean> {
  const result = await db
    .updateTable("outbox")
    .set({
      status: "sent",
      sent_at: sent.at,
      external_message_id: sent.messageId,
      // The cache of the sent message (ADR 0032 point 5): the stored text is the sent text.
      text: sent.message.text,
      buttons: JSON.stringify(outButtonsSchema.parse(sent.message.buttons)),
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
// A claim that took a row over from a dead run (`wasStale`) counts one attempt of that row, so a row that keeps crashing its sender ends
// as `too_many_errors`. The token compare-and-set is the one of `releaseOutbox`.
export async function countOutboxAttempt(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date
): Promise<boolean> {
  const result = await db
    .updateTable("outbox")
    .set((eb) => ({ attempts: eb("attempts", "+", 1) }))
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
  const failed = await db
    .updateTable("outbox")
    .set({ status: "failed", locked_at: null, error_code: code })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .where("status", "=", "sending")
    .where("locked_at", "=", lockedAt)
    .returning(["id", "kind", "view", "created_at"])
    .execute();
  await releaseMarksOfFailedDigests(db, ctx, failed);
  return failed.length === 1;
}
