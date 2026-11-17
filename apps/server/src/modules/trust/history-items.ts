// The item rows of a history check (F110 D10, D13): one row per classified mail, written with the cost of its call. Codes, counts,
// ids and money only: no mail text and no address.
import { categorySchema, type Category } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import type { ClaimedCheck } from "./history-queue";

export interface NewItem {
  emailId: string;
  category: Category;
  confidence: number;
  reasonCode: string;
  wouldMove: boolean;
  actedOn: boolean;
  source: "triage_result" | "classified" | "rule";
  costUsd: number;
}

export interface StoredItem {
  emailId: string;
  category: Category;
  wouldMove: boolean;
  actedOn: boolean;
}

/** The mail that already has an item in this check. */
export async function listItemEmailIds(db: Db, ctx: TenantContext, checkId: string): Promise<Set<string>> {
  const rows = await db
    .selectFrom("history_check_items")
    .select("email_id")
    .where("org_id", "=", ctx.orgId)
    .where("check_id", "=", checkId)
    .execute();
  return new Set(rows.map((row) => row.email_id));
}

/** Every item of the check: the input of the result. */
export async function listItems(db: Db | Transaction<DB>, ctx: TenantContext, checkId: string): Promise<StoredItem[]> {
  const rows = await db
    .selectFrom("history_check_items")
    .select(["email_id", "category", "would_move", "acted_on"])
    .where("org_id", "=", ctx.orgId)
    .where("check_id", "=", checkId)
    .orderBy("email_id")
    .execute();
  return rows.map((row) => ({
    emailId: row.email_id,
    category: categorySchema.parse(row.category),
    wouldMove: row.would_move,
    actedOn: row.acted_on,
  }));
}

/**
 * Writes one item and adds its cost to the check, in one transaction under the lock of the claim. Returns the new total cost, or null
 * when the lock is lost or the check has the item already (a repeat after a crash): then nothing is written.
 */
export async function recordItem(
  db: Db,
  ctx: TenantContext,
  check: ClaimedCheck,
  item: NewItem
): Promise<number | null> {
  return db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto("history_check_items")
      .values({
        check_id: check.id,
        org_id: ctx.orgId,
        email_id: item.emailId,
        category: item.category,
        confidence: item.confidence,
        reason_code: item.reasonCode,
        would_move: item.wouldMove,
        acted_on: item.actedOn,
        source: item.source,
        cost_usd: String(item.costUsd),
      })
      .onConflict((oc) => oc.columns(["check_id", "email_id"]).doNothing())
      .returning("email_id")
      .executeTakeFirst();
    if (inserted === undefined) return null;
    const total = await trx
      .updateTable("history_checks")
      .set({ cost_usd: sql`cost_usd + ${String(item.costUsd)}::numeric` })
      .where("id", "=", check.id)
      .where("org_id", "=", ctx.orgId)
      .where("locked_at", "=", check.lockedAt)
      .where("status", "=", "classifying")
      .returning("cost_usd")
      .executeTakeFirst();
    // The lock is lost: the whole transaction rolls back, so the item and the cost stay out together.
    if (total === undefined) {
      throw new LockLostError();
    }
    return Number(total.cost_usd);
  });
}

export class LockLostError extends Error {
  constructor() {
    super("history check lock lost");
    this.name = "LockLostError";
  }
}
