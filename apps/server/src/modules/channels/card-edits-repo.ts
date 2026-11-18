import { userLocaleSchema, type UserLocale } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import { OUTBOX_REMOVED_TEXT } from "./repo";
import { sendIdOfCardKey } from "./review-keys";

type DbOrTrx = Db | Transaction<DB>;

// The dedup key of an approval card of one send: `approval:<id>` (the detector) or `approval:<id>:r<n>` (a review card of a reply). A send id is a UUID, so the LIKE pattern has no wildcard of its own.
function cardKeyOfSend(sendId: string) {
  return sql<boolean>`(dedup_key = ${`approval:${sendId}`} or dedup_key like ${`approval:${sendId}:r%`})`;
}

export interface CardOfSend {
  id: string;
  userId: string;
  status: string;
  text: string | null;
  externalMessageId: string | null;
  emailId: string | null;
  // A follow-up card hangs on its loop.
  loopId: string | null;
  locale: UserLocale;
}

// The approval request cards (kind `approval`, dedup `approval:<send id>`, or `approval:<send id>:r<n>` for a review card) of one send.
// The set cards (`approval_set:`) are another kind and never match. Oldest first, so the queue order of the edits is stable.
export async function listCardsOfSend(db: DbOrTrx, ctx: TenantContext, sendId: string): Promise<CardOfSend[]> {
  const rows = await db
    .selectFrom("outbox")
    .select(["id", "user_id", "status", "text", "external_message_id", "email_id", "loop_id", "locale"])
    .where("org_id", "=", ctx.orgId)
    .where("kind", "=", "approval")
    .where(cardKeyOfSend(sendId))
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
    loopId: row.loop_id,
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
    .where(cardKeyOfSend(sendId))
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
  const sendId = row === undefined ? null : sendIdOfCardKey(row.dedup_key);
  if (!row || row.external_message_id === null || !row.text || sendId === null) return undefined;
  return {
    id: row.id,
    messageId: Number(row.external_message_id),
    sentAt: row.sent_at,
    text: row.text,
    sendId,
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

// The follow-ups whose loop closed (`expired` / `loop_closed`) and whose approval card still shows the buttons: a card that no sender took
// (`pending`) or one that went out (`sent`) with no `expired` edit queued yet. The decision hooks cannot reach these ends (the committer,
// the switch-off and the close rules end a send without an approval hook), so a detector finds them. A sent card with no text (retention)
// or no message id has nothing to edit (the skips of `queueCardEdits`): it is not listed, so it cannot hold a place in the limit for ever. `endedAt` is the time of the end.
export async function listClosedFollowUpCards(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number }
): Promise<{ sendId: string; endedAt: Date }[]> {
  const rows = await db
    .selectFrom("actions")
    .select(["actions.id", "actions.updated_at"])
    .where("actions.org_id", "=", ctx.orgId)
    .where("actions.type", "=", "send")
    .where("actions.loop_id", "is not", null)
    .where("actions.status", "=", "expired")
    .where("actions.status_reason", "=", "loop_closed")
    .where(
      sql<boolean>`exists (
      select 1 from outbox card
      where card.org_id = actions.org_id and card.kind = 'approval'
        and card.dedup_key = 'approval:' || actions.id::text
        and (card.status = 'pending'
          or (card.status = 'sent'
            and card.text is not null and card.text <> '' and card.text <> ${OUTBOX_REMOVED_TEXT}
            and card.external_message_id is not null
            and not exists (
            select 1 from outbox edit
            where edit.org_id = card.org_id and edit.user_id = card.user_id
              and edit.dedup_key = 'approval_edit:' || card.id::text || ':expired')))
    )`
    )
    .orderBy("actions.updated_at")
    .orderBy("actions.id")
    .limit(opts.limit)
    .execute();
  return rows.map((row) => ({ sendId: row.id, endedAt: row.updated_at }));
}

// The newest `created_at` of an edit row of one card, in any state; null for a card with no edit row yet. Decisions on one send run
// one after the other (each holds the send lock until it commits), so the edit rows of a card are queued in decision order.
export async function newestEditCreatedAt(db: DbOrTrx, ctx: TenantContext, cardId: string): Promise<Date | null> {
  const row = await db
    .selectFrom("outbox")
    .select("created_at")
    .where("org_id", "=", ctx.orgId)
    .where("kind", "=", "approval_edit")
    .where("edit_of_outbox_id", "=", cardId)
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.created_at ?? null;
}
