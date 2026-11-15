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
