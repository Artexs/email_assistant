// The queue side of the history job: claim, lock, wait, advance, fail and end one check. Every write after a claim
// holds the lock of the claim (`locked_at` equal to the claimed value): a run whose lock was taken back after 10 minutes
// writes nothing. Codes, ids, counts and times only: no mail text and no address.
import { type EvidenceKey, MINUTE_MS } from "@ea/core";
import { sql, type Transaction, type UpdateObject } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";

import {
  queueHistoryCheck,
  type HistoryCheckReason,
  type HistoryCheckStatus,
  type HistoryResult,
  type NoResultReason,
} from "./repo";

const log = createLog("trust");

/** The window of the check: the last 30 days of INBOX mail. */
export const HISTORY_WINDOW_DAYS = 30;
/** A lock older than this is stale: the next run takes the check again and counts one attempt. */
export const HISTORY_LOCK_STALE_MS = 10 * MINUTE_MS;
/** A step error or a wait reschedules the check by this much. */
export const HISTORY_RETRY_MS = 5 * MINUTE_MS;
/** The third attempt ends the check as `no_result` / `stopped`. */
export const HISTORY_MAX_ATTEMPTS = 3;

/** The statuses that the job moves: every open status. */
export const HISTORY_STEP_STATUSES = [
  "queued",
  "backfilling",
  "waiting_flags",
  "classifying",
] as const satisfies readonly HistoryCheckStatus[];
export type HistoryStepStatus = (typeof HISTORY_STEP_STATUSES)[number];

export interface ClaimedCheck {
  id: string;
  mailboxId: string;
  status: HistoryStepStatus;
  reason: HistoryCheckReason;
  attempts: number;
  /** Null until the backfill has read the mailbox: the window is the window of that read. */
  windowStart: Date | null;
  backfillDoneAt: Date | null;
  /** The evidence key of the backfill (stored by `markBackfilled`); null before it. The classify step compares it with the running key. */
  key: unknown;
  /** The spend of this check so far (the sum of its item costs). */
  costUsd: number;
  /** The lock value of this claim: the guard of every later write. */
  lockedAt: Date;
}

/** What a check that ends (a result or no result) tells the job: it runs inside the transaction of the end, so the notice commits with it. */
export type EndedHook = (
  trx: Transaction<DB>,
  ctx: TenantContext,
  ended: { checkId: string; mailboxId: string; reason: NoResultReason | null }
) => Promise<void>;

/**
 * The hook of a check that ends because it ran out of attempts (`stopped`). A hook that throws every time must not keep such a check open:
 * the hook runs under a savepoint, a failure rolls back the hook alone and is logged, and the check still ends (without its notice).
 * The other ends let the hook fail the step, which costs an attempt: three attempts later the check ends here.
 */
async function endedOrLogged(
  trx: Transaction<DB>,
  ctx: TenantContext,
  onEnded: EndedHook | undefined,
  ended: Parameters<EndedHook>[2]
): Promise<void> {
  if (onEnded === undefined) return;
  await sql`savepoint ended_hook`.execute(trx);
  try {
    await onEnded(trx, ctx, ended);
    await sql`release savepoint ended_hook`.execute(trx);
  } catch (error) {
    await sql`rollback to savepoint ended_hook`.execute(trx);
    log
      .with({ org_id: ctx.orgId, mailbox_id: ended.mailboxId, check_id: ended.checkId })
      .warn("history_ended_hook_failed", { ...errorFields(error) });
  }
}

/** What the claim did with the oldest due check of an organization. */
export type ClaimResult =
  | { kind: "none" }
  | { kind: "claimed"; check: ClaimedCheck }
  // The take-back of a stale lock was the third attempt: the check ended without a step.
  | { kind: "stopped"; checkId: string; mailboxId: string };

type Conn = Db | Transaction<DB>;

const staleBefore = (now: Date): Date => new Date(now.getTime() - HISTORY_LOCK_STALE_MS);

/**
 * The organizations with a due check (any org, no tenant scope: the job lists work across tenants), the one that waited longest first:
 * a run that stops at its time budget leaves the later organizations for the next run, and none of them waits for ever.
 */
export async function listOrgsWithDueChecks(db: Conn, now: Date): Promise<string[]> {
  const rows = await db
    .selectFrom("history_checks")
    .select("org_id")
    .where("status", "in", HISTORY_STEP_STATUSES)
    .where("next_attempt_at", "<=", now)
    .where((eb) => eb.or([eb("locked_at", "is", null), eb("locked_at", "<", staleBefore(now))]))
    .groupBy("org_id")
    .orderBy(sql`min(next_attempt_at)`)
    .orderBy("org_id")
    .execute();
  return rows.map((row) => row.org_id);
}

/**
 * Claims the oldest due check of one organization: `FOR UPDATE SKIP LOCKED` inside one short transaction, so two runs at once
 * never claim the same row. A stale lock is taken back
 * and counts one attempt.
 */
export async function claimNextCheck(db: Db, ctx: TenantContext, now: Date, onEnded?: EndedHook): Promise<ClaimResult> {
  return db.transaction().execute(async (trx): Promise<ClaimResult> => {
    const row = await trx
      .selectFrom("history_checks")
      .select([
        "id",
        "mailbox_id",
        "status",
        "reason",
        "attempts",
        "window_start",
        "backfill_done_at",
        "locked_at",
        "key",
        "cost_usd",
      ])
      .where("org_id", "=", ctx.orgId)
      .where("status", "in", HISTORY_STEP_STATUSES)
      .where("next_attempt_at", "<=", now)
      .where((eb) => eb.or([eb("locked_at", "is", null), eb("locked_at", "<", staleBefore(now))]))
      .orderBy("next_attempt_at")
      .orderBy("created_at")
      .orderBy("id")
      .limit(1)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (row === undefined) return { kind: "none" };
    const attempts = row.attempts + (row.locked_at === null ? 0 : 1);
    if (attempts >= HISTORY_MAX_ATTEMPTS) {
      await trx
        .updateTable("history_checks")
        .set({ attempts, status: "no_result", no_result_reason: "stopped", finished_at: now, locked_at: null })
        .where("id", "=", row.id)
        .where("org_id", "=", ctx.orgId)
        .execute();
      await endedOrLogged(trx, ctx, onEnded, { checkId: row.id, mailboxId: row.mailbox_id, reason: "stopped" });
      return { kind: "stopped", checkId: row.id, mailboxId: row.mailbox_id };
    }
    await trx
      .updateTable("history_checks")
      .set({ attempts, locked_at: now })
      .where("id", "=", row.id)
      .where("org_id", "=", ctx.orgId)
      .execute();
    return {
      kind: "claimed",
      check: {
        id: row.id,
        mailboxId: row.mailbox_id,
        status: row.status as HistoryStepStatus,
        reason: row.reason as HistoryCheckReason,
        attempts,
        windowStart: row.window_start,
        backfillDoneAt: row.backfill_done_at,
        key: row.key,
        costUsd: Number(row.cost_usd),
        lockedAt: now,
      },
    };
  });
}

/** A write that keeps the lock: it changes the row only while `locked_at` still equals the value of the claim. */
async function guardedUpdate(
  db: Conn,
  ctx: TenantContext,
  check: ClaimedCheck,
  set: UpdateObject<DB, "history_checks">
): Promise<boolean> {
  const updated = await db
    .updateTable("history_checks")
    .set(set)
    .where("id", "=", check.id)
    .where("org_id", "=", ctx.orgId)
    .where("locked_at", "=", check.lockedAt)
    .where("status", "in", HISTORY_STEP_STATUSES)
    .returning("id")
    .executeTakeFirst();
  return updated !== undefined;
}

/** The step started: the status moves and the lock stays. False when the lock is lost. */
export function markStatus(
  db: Conn,
  ctx: TenantContext,
  check: ClaimedCheck,
  status: HistoryStepStatus
): Promise<boolean> {
  return guardedUpdate(db, ctx, check, { status });
}

/**
 * The backfill ended: the window of its read (`windowStart`), the end time and the evidence key of the moment are stored, the status is
 * `waiting_flags`, the lock stays. The window is set here and not at the claim: a check that waited (a paused mailbox, a mailbox that
 * never synced) would otherwise have a window longer than the 30 days that the backfill and the flag refresh read.
 */
export function markBackfilled(
  db: Conn,
  ctx: TenantContext,
  check: ClaimedCheck,
  done: { at: Date; windowStart: Date; key: EvidenceKey }
): Promise<boolean> {
  return guardedUpdate(db, ctx, check, {
    status: "waiting_flags",
    window_start: done.windowStart,
    backfill_done_at: done.at,
    key: JSON.stringify(done.key),
  });
}

/** Releases the lock and sets the next run (a wait with no attempt, or the next step). */
export function releaseCheck(
  db: Conn,
  ctx: TenantContext,
  check: ClaimedCheck,
  next: { at: Date; status?: HistoryCheckStatus }
): Promise<boolean> {
  return guardedUpdate(db, ctx, check, {
    locked_at: null,
    next_attempt_at: next.at,
    ...(next.status === undefined ? {} : { status: next.status }),
  });
}

/** Ends the check without a result. `finished_at` is written with the status. The hook runs in the same transaction. */
export async function endCheck(
  db: Db,
  ctx: TenantContext,
  check: ClaimedCheck,
  reason: NoResultReason,
  now: Date,
  onEnded?: EndedHook
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const ended = await guardedUpdate(trx, ctx, check, {
      status: "no_result",
      no_result_reason: reason,
      finished_at: now,
      locked_at: null,
    });
    if (ended) await onEnded?.(trx, ctx, { checkId: check.id, mailboxId: check.mailboxId, reason });
    return ended;
  });
}

/**
 * The running key is not the key of the check: the check ends `no_result` / `key_changed` and a new check with the reason
 * `model_switch` is queued, in one transaction (the old row must end first: one open check per mailbox).
 */
export async function endCheckKeyChanged(db: Db, ctx: TenantContext, check: ClaimedCheck, now: Date): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const ended = await guardedUpdate(trx, ctx, check, {
      status: "no_result",
      no_result_reason: "key_changed",
      finished_at: now,
      locked_at: null,
    });
    if (ended) await queueHistoryCheck(trx, ctx, check.mailboxId, "model_switch");
    return ended;
  });
}

/** The classify step finished: the result per moving category, `done` and `finished_at` together. The hook runs in the same transaction. */
export async function completeCheck(
  db: Db,
  ctx: TenantContext,
  check: ClaimedCheck,
  done: { result: Required<HistoryResult>; capped: boolean; now: Date },
  onEnded?: EndedHook
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const completed = await guardedUpdate(trx, ctx, check, {
      status: "done",
      result: JSON.stringify(done.result),
      capped: done.capped,
      finished_at: done.now,
      locked_at: null,
    });
    if (completed) await onEnded?.(trx, ctx, { checkId: check.id, mailboxId: check.mailboxId, reason: null });
    return completed;
  });
}

/**
 * A step error: one more attempt and a retry in 5 minutes; the third attempt ends the check as `stopped`. The count
 * is read and written in one statement, so a take-back that raised it in between is not lost.
 * Returns the new state, or null when the lock is lost.
 */
export async function failStep(
  db: Db,
  ctx: TenantContext,
  check: ClaimedCheck,
  now: Date,
  onEnded?: EndedHook
): Promise<{ attempts: number; stopped: boolean } | null> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable("history_checks")
      .set({
        attempts: sql`attempts + 1`,
        status: sql`case when attempts + 1 >= ${HISTORY_MAX_ATTEMPTS} then 'no_result' else status end`,
        no_result_reason: sql`case when attempts + 1 >= ${HISTORY_MAX_ATTEMPTS} then 'stopped' else no_result_reason end`,
        finished_at: sql`case when attempts + 1 >= ${HISTORY_MAX_ATTEMPTS} then ${now}::timestamptz else finished_at end`,
        next_attempt_at: new Date(now.getTime() + HISTORY_RETRY_MS),
        locked_at: null,
      })
      .where("id", "=", check.id)
      .where("org_id", "=", ctx.orgId)
      .where("locked_at", "=", check.lockedAt)
      .where("status", "in", HISTORY_STEP_STATUSES)
      .returning(["attempts", "status"])
      .executeTakeFirst();
    if (row === undefined) return null;
    const stopped = row.status === "no_result";
    if (stopped) {
      await endedOrLogged(trx, ctx, onEnded, { checkId: check.id, mailboxId: check.mailboxId, reason: "stopped" });
    }
    return { attempts: row.attempts, stopped };
  });
}

/** The mailboxes of the list that have no `history_checks` row at all (a cheap read before the locked insert of `queueFlagOnCheck`). */
export async function listMailboxesWithoutCheck(db: Conn, ctx: TenantContext, mailboxIds: string[]): Promise<string[]> {
  if (mailboxIds.length === 0) return [];
  const rows = await db
    .selectFrom("mailboxes as m")
    .select("m.id")
    .where("m.org_id", "=", ctx.orgId)
    .where("m.id", "in", mailboxIds)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("history_checks as h")
            .select("h.id")
            .whereRef("h.mailbox_id", "=", "m.id")
            .where("h.org_id", "=", ctx.orgId)
        )
      )
    )
    .orderBy("m.created_at")
    .orderBy("m.id")
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Queues a check with the reason `flag_on` for a mailbox that has no `history_checks` row at all. The mailbox row is
 * locked first: two runs at once take the lock one after the other, and the second run sees the row of the first. Returns true when
 * it queued a check.
 */
export async function queueFlagOnCheck(db: Db, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const mailbox = await trx
      .selectFrom("mailboxes")
      .select("id")
      .where("id", "=", mailboxId)
      .where("org_id", "=", ctx.orgId)
      .forUpdate()
      .executeTakeFirst();
    if (mailbox === undefined) return false;
    const any = await trx
      .selectFrom("history_checks")
      .select("id")
      .where("org_id", "=", ctx.orgId)
      .where("mailbox_id", "=", mailboxId)
      .limit(1)
      .executeTakeFirst();
    if (any !== undefined) return false;
    const inserted = await trx
      .insertInto("history_checks")
      .values({ org_id: ctx.orgId, mailbox_id: mailboxId, reason: "flag_on" })
      .onConflict((oc) =>
        oc
          .column("mailbox_id")
          .where(sql<boolean>`status not in ('done', 'no_result')`)
          .doNothing()
      )
      .returning("id")
      .executeTakeFirst();
    return inserted !== undefined;
  });
}
