import {
  barCategories,
  movingCategories,
  type BarCategory,
  type HistoryOutcome,
  type MovingCategory,
  type TripReason,
  type TripState,
} from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";

export type DbOrTrx = Db | Transaction<DB>;

export const historyCheckStatusSchema = z.enum([
  "queued",
  "backfilling",
  "waiting_flags",
  "classifying",
  "done",
  "no_result",
]);
export type HistoryCheckStatus = z.infer<typeof historyCheckStatusSchema>;

export const historyCheckReasonSchema = z.enum(["connect", "cli", "web", "model_switch", "flag_on"]);
export type HistoryCheckReason = z.infer<typeof historyCheckReasonSchema>;

export const noResultReasonSchema = z.enum([
  "no_history",
  "uidvalidity",
  "cost_unknown",
  "stopped",
  "key_changed",
  "auth_refused",
  "model_failing",
]);
export type NoResultReason = z.infer<typeof noResultReasonSchema>;

// The checks that still run: the partial unique index of `history_checks` lets one of them exist per mailbox.
export const OPEN_CHECK_STATUSES = ["queued", "backfilling", "waiting_flags", "classifying"] as const;

export const tripReasonSchema = z.enum([
  "corrections",
  "important_hidden",
  "model_switch",
  "evidence_changed",
  "history_fail",
]);

// What the check decided for one moving category (the `result` column holds one entry per category).
export interface HistoryCategoryResult {
  outcome: HistoryOutcome;
  acted: number;
  moved: number;
  upper: number | null;
  total: number;
  wouldMove: number;
}

export const historyCategoryResultSchema: z.ZodType<HistoryCategoryResult> = z.object({
  outcome: z.enum(["pass", "fail", "inconclusive", "no_result"]),
  acted: z.number().int().min(0),
  moved: z.number().int().min(0),
  upper: z.number().min(0).max(1).nullable(),
  total: z.number().int().min(0),
  wouldMove: z.number().int().min(0),
});

// The stored shape of `history_checks.result`: one entry per moving category.
export const historyResultSchema = z.object({
  info: historyCategoryResultSchema.optional(),
  notification: historyCategoryResultSchema.optional(),
  spam: historyCategoryResultSchema.optional(),
});
export type HistoryResult = z.infer<typeof historyResultSchema>;

export interface HistoryCheckRow {
  id: string;
  mailboxId: string;
  status: HistoryCheckStatus;
  reason: HistoryCheckReason;
  noResultReason: NoResultReason | null;
  key: unknown;
  windowStart: Date | null;
  backfillDoneAt: Date | null;
  costUsd: number;
  capped: boolean;
  result: HistoryResult | null;
  attempts: number;
  createdAt: Date;
  finishedAt: Date | null;
}

const checkColumns = [
  "id",
  "mailbox_id",
  "status",
  "reason",
  "no_result_reason",
  "key",
  "window_start",
  "backfill_done_at",
  "cost_usd",
  "capped",
  "result",
  "attempts",
  "created_at",
  "finished_at",
] as const;

/**
 * Queues a history check for a mailbox. Returns the new id, or null when a check of this mailbox is still open: the
 * partial unique index decides, so two callers at once make one row. A `done` or `no_result` check does not block.
 */
export async function queueHistoryCheck(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  reason: HistoryCheckReason
): Promise<string | null> {
  const inserted = await db
    .insertInto("history_checks")
    .values({ org_id: ctx.orgId, mailbox_id: mailboxId, reason })
    .onConflict((oc) =>
      oc
        .column("mailbox_id")
        .where(sql<boolean>`status not in ('done', 'no_result')`)
        .doNothing()
    )
    .returning("id")
    .executeTakeFirst();
  return inserted?.id ?? null;
}

/** The newest check of a mailbox, of any status. */
export async function latestHistoryCheck(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<HistoryCheckRow | null> {
  const row = await db
    .selectFrom("history_checks")
    .select(checkColumns)
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row === undefined ? null : toCheckRow(row);
}

/** The newest `done` check of a mailbox with its result and its end time (null: none). Same order as `historyResultFor`. */
export async function newestDoneCheck(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<{ result: HistoryResult | null; finishedAt: Date | null } | null> {
  const row = await db
    .selectFrom("history_checks")
    .select(["result", "finished_at"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("status", "=", "done")
    .orderBy(sql`finished_at desc nulls last`)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (row === undefined) return null;
  return { result: row.result == null ? null : historyResultSchema.parse(row.result), finishedAt: row.finished_at };
}

/**
 * The result of the newest `done` check, per moving category (null: the check has no entry for it). A newer check that
 * ended without a result does not hide it: a `fail` stays until a newer `done` check replaces it.
 */
export async function historyResultFor(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<Record<MovingCategory, HistoryCategoryResult | null>> {
  const result = (await newestDoneCheck(db, ctx, mailboxId))?.result ?? null;
  return Object.fromEntries(movingCategories.map((category) => [category, result?.[category] ?? null])) as Record<
    MovingCategory,
    HistoryCategoryResult | null
  >;
}

/** The categories of a mailbox that a trip pauses now (rows that are not cleared). */
export async function activeTripsOf(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<Map<BarCategory, TripState>> {
  const rows = await db
    .selectFrom("autonomy_trips")
    .select(["category", "reason", "tripped_at"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("cleared_at", "is", null)
    .orderBy("tripped_at", "asc")
    .orderBy("id", "asc")
    .execute();
  const trips = new Map<BarCategory, TripState>();
  for (const row of rows) {
    const category = z.enum(barCategories).parse(row.category);
    // Rows come oldest first, so the newest trip of a category wins.
    trips.set(category, { tripped: true, reason: tripReasonSchema.parse(row.reason), at: row.tripped_at });
  }
  return trips;
}

export interface NewTrip {
  mailboxId: string;
  category: BarCategory;
  grantedAt: Date;
  reason: TripReason;
  counts: Record<string, number>;
}

/**
 * Records a trip for one grant. Returns the id, or null when the grant has a trip already (the unique key
 * `(mailbox, category, granted_at)`): the tripwire can run twice and still pauses once.
 */
export async function insertTrip(trx: Transaction<DB>, ctx: TenantContext, row: NewTrip): Promise<string | null> {
  const inserted = await trx
    .insertInto("autonomy_trips")
    .values({
      org_id: ctx.orgId,
      mailbox_id: row.mailboxId,
      category: row.category,
      granted_at: row.grantedAt,
      reason: row.reason,
      counts: JSON.stringify(row.counts),
    })
    .onConflict((oc) => oc.columns(["mailbox_id", "category", "granted_at"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  return inserted?.id ?? null;
}

/** Ends the active trips of one category (the user turned `auto` on again). Returns how many it cleared. */
export async function clearTrips(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  category: BarCategory,
  at: Date
): Promise<number> {
  const cleared = await trx
    .updateTable("autonomy_trips")
    .set({ cleared_at: at })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("category", "=", category)
    .where("cleared_at", "is", null)
    .returning("id")
    .execute();
  return cleared.length;
}

function toCheckRow(row: {
  id: string;
  mailbox_id: string;
  status: string;
  reason: string;
  no_result_reason: string | null;
  key: unknown;
  window_start: Date | null;
  backfill_done_at: Date | null;
  cost_usd: string;
  capped: boolean;
  result: unknown;
  attempts: number;
  created_at: Date;
  finished_at: Date | null;
}): HistoryCheckRow {
  return {
    id: row.id,
    mailboxId: row.mailbox_id,
    status: historyCheckStatusSchema.parse(row.status),
    reason: historyCheckReasonSchema.parse(row.reason),
    noResultReason: row.no_result_reason === null ? null : noResultReasonSchema.parse(row.no_result_reason),
    key: row.key,
    windowStart: row.window_start,
    backfillDoneAt: row.backfill_done_at,
    costUsd: Number(row.cost_usd),
    capped: row.capped,
    result: row.result == null ? null : historyResultSchema.parse(row.result),
    attempts: row.attempts,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

/**
 * How many other checks of the mailbox ended already, as `done` or as `no_result` for a reason other than `key_changed`: a check that a
 * model switch cut short is not "the first check" of the report notice (F110 D16). A quiet end (see below) does not count either.
 */
export async function countEarlierEndedChecks(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  exceptCheckId: string
): Promise<number> {
  const row = await db
    .selectFrom("history_checks")
    .select(sql<string>`count(*)`.as("n"))
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("id", "!=", exceptCheckId)
    .where("status", "in", ["done", "no_result"])
    .where((eb) => eb.or([eb("no_result_reason", "is", null), eb("no_result_reason", "!=", "key_changed")]))
    // A check that reached the classify step and found no mail to classify (the synthetic scope with no test mail) queued no notice: the
    // backfill had ended (`backfill_done_at`), which a `no_history` end of the backfill step never has. It must not use up the notice.
    .where((eb) =>
      eb.or([
        eb("no_result_reason", "is", null),
        eb("no_result_reason", "!=", "no_history"),
        eb("backfill_done_at", "is", null),
      ])
    )
    .executeTakeFirstOrThrow();
  return Number(row.n);
}
