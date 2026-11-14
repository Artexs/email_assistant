import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

// The first step of the apply step for a draft or a send: it commits before any APPEND or SMTP call (D17).
// `locked_at` stays: the claim token is valid through the step.
// A send starts only from `approved` with `approved_at` set; a draft from `ready` or `approved`.
export async function markApplying(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  opts?: { outgoingMessageId?: string }
): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set((eb) => ({
      status: "applying",
      outgoing_message_id: opts?.outgoingMessageId ?? eb.ref("outgoing_message_id"),
      updated_at: sql<Date>`now()`,
    }))
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where((eb) =>
      eb.or([
        eb.and([eb("type", "=", "send"), eb("status", "=", "approved"), eb("approved_at", "is not", null)]),
        eb.and([eb("type", "<>", "send"), eb("status", "in", ["ready", "approved"])]),
      ])
    )
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
type ProviderResult = Record<string, string | number | boolean | null>;
export type FinishNext =
  | { status: "applied"; at: Date; providerResult?: ProviderResult }
  | {
      status: "failed";
      at: Date;
      reason: string;
      lastError?: string;
      countAttempt?: true;
      // S4: a send failure stores { stage, response_code, code } for the result notice (D20).
      providerResult?: ProviderResult;
    }
  // S4: an `applying` draft whose send ended before the APPEND (N12).
  | { status: "expired"; at: Date; reason: "send_closed" };
// `lockedAt` is the claim token: a stale run that lost its claim changes nothing.
// `next.at` is the run clock: it sets `updated_at` (and `applied_at`). `from` lists the statuses that may finish.
// `countAttempt` on a failure counts the try that failed (the third hard error leaves `attempts` = 3).
export async function finishAction(
  trx: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  next: FinishNext,
  opts?: { from?: readonly ("ready" | "approved" | "applying")[] }
): Promise<boolean> {
  const common = { locked_at: null, next_attempt_at: null, updated_at: next.at };
  let values: Record<string, unknown>;
  if (next.status === "applied") {
    values = {
      ...common,
      status: "applied",
      applied_at: next.at,
      last_error: null,
      provider_result: next.providerResult === undefined ? null : JSON.stringify(next.providerResult),
    };
  } else if (next.status === "failed") {
    values = {
      ...common,
      status: "failed",
      status_reason: next.reason,
      ...(next.providerResult === undefined ? {} : { provider_result: JSON.stringify(next.providerResult) }),
    };
  } else {
    values = { ...common, status: "expired", status_reason: next.reason };
  }
  const result = await trx
    .updateTable("actions")
    .set((eb) => ({
      ...values,
      ...(next.status === "failed"
        ? {
            last_error: next.lastError ?? eb.ref("last_error"),
            ...(next.countAttempt ? { attempts: eb("attempts", "+", 1) } : {}),
          }
        : {}),
    }))
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("status", "in", [...(opts?.from ?? ["ready", "applying"])])
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
// Puts the row back in `toStatus` with the lock cleared: an `applying` send whose SMTP call never started goes back to
// `approved`; a draft that could not start goes back to `ready`.
export async function releaseAction(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  lockedAt: Date,
  opts: {
    toStatus: "ready" | "approved" | "applying";
    nextAttemptAt: Date | null;
    countAttempt: boolean;
    now: Date;
    lastError?: string;
  }
): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set((eb) => ({
      status: opts.toStatus,
      locked_at: null,
      next_attempt_at: opts.nextAttemptAt,
      attempts: opts.countAttempt ? eb("attempts", "+", 1) : eb.ref("attempts"),
      last_error: opts.lastError ?? eb.ref("last_error"),
      updated_at: opts.now,
    }))
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("status", "in", ["ready", "approved", "applying"])
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
// No attempt count, `next_attempt_at` and status unchanged: the rows of a batch that did not run stay in their pre-claim
// status (`markApplying` is the first thing the apply step does for a row).
export async function releaseActions(
  db: DbOrTrx,
  ctx: TenantContext,
  ids: readonly string[],
  lockedAt: Date,
  now: Date
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .updateTable("actions")
    .set({ locked_at: null, updated_at: now })
    .where("id", "in", [...ids])
    .where("org_id", "=", ctx.orgId)
    .where("status", "in", ["ready", "approved", "applying"])
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}
// jsonb merge (`provider_result || patch`), e.g. the Sent copy outcome after `applied`.
export async function updateProviderResult(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set({ provider_result: sql`coalesce(provider_result, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
