import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

// null = the slot has a row already.
export async function insertDigest(
  db: DbOrTrx,
  ctx: TenantContext,
  row: { userId: string; slotKey: string; periodStart: Date; periodEnd: Date }
): Promise<string | null> {
  const inserted = await db
    .insertInto("digests")
    .values({
      org_id: ctx.orgId,
      user_id: row.userId,
      slot_key: row.slotKey,
      period_start: row.periodStart,
      period_end: row.periodEnd,
    })
    .onConflict((oc) => oc.columns(["org_id", "user_id", "slot_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  return inserted?.id ?? null;
}

// The greatest slot key of the member, sent or not.
export async function lastDigestSlotKey(db: DbOrTrx, ctx: TenantContext, userId: string): Promise<string | null> {
  const row = await db
    .selectFrom("digests")
    .select("slot_key")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .orderBy("slot_key", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.slot_key ?? null;
}

export async function lastSentDigestEnd(db: DbOrTrx, ctx: TenantContext, userId: string): Promise<Date | null> {
  const row = await db
    .selectFrom("digests")
    .select("period_end")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("sent_at", "is not", null)
    .orderBy("period_end", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.period_end ?? null;
}

export async function markDigestSent(db: DbOrTrx, ctx: TenantContext, digestId: string, at: Date): Promise<boolean> {
  const result = await db
    .updateTable("digests")
    .set({ sent_at: at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", digestId)
    .where("sent_at", "is", null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

// F099 D14: the newest `sent_at` of a digest of the organization, null when none was sent.
export async function lastDigestSentAt(db: DbOrTrx, ctx: TenantContext): Promise<Date | null> {
  const row = await db
    .selectFrom("digests")
    .select("sent_at")
    .where("org_id", "=", ctx.orgId)
    .where("sent_at", "is not", null)
    .orderBy("sent_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.sent_at ?? null;
}
