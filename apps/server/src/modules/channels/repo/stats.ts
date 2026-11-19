import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

// The newest `sent_at` of an outbox row of the organization, null when none was sent.
export async function lastOutboxSentAt(db: DbOrTrx, ctx: TenantContext): Promise<Date | null> {
  const row = await db
    .selectFrom("outbox")
    .select("sent_at")
    .where("org_id", "=", ctx.orgId)
    .where("sent_at", "is not", null)
    .orderBy("sent_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.sent_at ?? null;
}
// Failure codes that are no failure of the system: a cancellation (`outdated`, `expired`) and a push row whose device the user
// removed or signed out (`no_device`).
const FAILED_NOT_COUNTED = ["outdated", "expired", "no_device"];
// Failed outbox rows created after `since`. The outbox has no failure time; the sender gives up
// 24 h after the queue time, so `created_at` bounds it.
export async function countFailedOutboxSince(db: DbOrTrx, ctx: TenantContext, since: Date): Promise<number> {
  const row = await db
    .selectFrom("outbox")
    .select(sql<string>`count(*)`.as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "failed")
    .where("created_at", ">", since)
    .where((eb) => eb.or([eb("error_code", "is", null), eb("error_code", "not in", [...FAILED_NOT_COUNTED])]))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// The same count for every organization at once (an organization with no failed row has no entry).
export async function countFailedOutboxSinceOfAll(db: DbOrTrx, since: Date): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom("outbox")
    .select(["org_id", sql<string>`count(*)`.as("count")])
    .where("status", "=", "failed")
    .where("created_at", ">", since)
    .where((eb) => eb.or([eb("error_code", "is", null), eb("error_code", "not in", [...FAILED_NOT_COUNTED])]))
    .groupBy("org_id")
    .execute();
  return new Map(rows.map((row) => [row.org_id, Number(row.count)]));
}
