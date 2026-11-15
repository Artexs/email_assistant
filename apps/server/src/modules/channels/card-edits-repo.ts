import { userLocaleSchema, type UserLocale } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

export interface CardOfSend {
  id: string;
  userId: string;
  status: string;
  text: string | null;
  externalMessageId: string | null;
  emailId: string | null;
  locale: UserLocale;
}

// The approval request cards (kind `approval`, dedup `approval:<send id>`) of one send, one per owner. The set cards
// (`approval_set:`) are another kind and never match (Q15). Oldest first, so the queue order of the edits is stable.
export async function listCardsOfSend(db: DbOrTrx, ctx: TenantContext, sendId: string): Promise<CardOfSend[]> {
  const rows = await db
    .selectFrom("outbox")
    .select(["id", "user_id", "status", "text", "external_message_id", "email_id", "locale"])
    .where("org_id", "=", ctx.orgId)
    .where("kind", "=", "approval")
    .where("dedup_key", "=", `approval:${sendId}`)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    status: row.status,
    text: row.text,
    externalMessageId: row.external_message_id,
    emailId: row.email_id,
    locale: userLocaleSchema.parse(row.locale),
  }));
}

// A card that no sender took: the send has its answer, so the card never goes out (its buttons would answer "closed").
// Only `pending` rows: a `sending` row is in flight and finishes. Returns the number of cards changed.
export async function failPendingCardsOfSend(db: DbOrTrx, ctx: TenantContext, sendId: string): Promise<number> {
  const result = await db
    .updateTable("outbox")
    .set({ status: "failed", error_code: "answered_elsewhere", locked_at: null })
    .where("org_id", "=", ctx.orgId)
    .where("kind", "=", "approval")
    .where("dedup_key", "=", `approval:${sendId}`)
    .where("status", "=", "pending")
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

export interface EditTarget {
  id: string;
  messageId: number;
  sentAt: Date | null;
  text: string;
  // The send that the card asks about (`approval:<send id>`).
  sendId: string;
}

// The card that an `approval_edit` row edits: same organization and same user (the database also refuses a pointer across
// organizations), an approval card, `sent`, with a message id and its text. undefined: the sender fails the row (`no_target`).
export async function getEditTarget(
  db: DbOrTrx,
  ctx: TenantContext,
  edit: { targetId: string; userId: string }
): Promise<EditTarget | undefined> {
  const row = await db
    .selectFrom("outbox")
    .select(["id", "external_message_id", "sent_at", "text", "dedup_key"])
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", edit.targetId)
    .where("user_id", "=", edit.userId)
    .where("kind", "=", "approval")
    .where("status", "=", "sent")
    .executeTakeFirst();
  const prefix = "approval:";
  if (!row || row.external_message_id === null || !row.text || !row.dedup_key.startsWith(prefix)) return undefined;
  return {
    id: row.id,
    messageId: Number(row.external_message_id),
    sentAt: row.sent_at,
    text: row.text,
    sendId: row.dedup_key.slice(prefix.length),
  };
}

// A newer edit row of the same card that went out already: an older row must not overwrite it. "Newer" is a later
// `created_at` (the time of the decision); rows with the same time cannot be ordered, and the check of the outcome decides.
export async function newerEditSent(
  db: DbOrTrx,
  ctx: TenantContext,
  edit: { id: string; targetId: string; createdAt: Date }
): Promise<boolean> {
  const row = await db
    .selectFrom("outbox")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("kind", "=", "approval_edit")
    .where("edit_of_outbox_id", "=", edit.targetId)
    .where("status", "=", "sent")
    .where("id", "<>", edit.id)
    .where("created_at", ">", edit.createdAt)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
