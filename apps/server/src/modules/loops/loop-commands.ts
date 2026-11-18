import { defaultDue } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { lockSentSyncState } from "../mail";
import { getMembership, getOrganization, isFeatureOn } from "../tenancy";

import { expireFollowUpSends } from "./follow-up-expiry";
import {
  closeLoop,
  getLoop,
  lockLoop,
  MAX_LATER,
  reopenLoopRow,
  setLoopLater,
  type DbOrTrx,
  type LoopCloseReason,
  type LoopRow,
  type LoopVia,
} from "./repo";

// The commands of a loop that a user starts. Telegram and `/api` call them.
// Each one runs in one transaction, locks the loop first (the lock order: loop, then its sends) and writes one audit row with the `via`. A closing
// command ends the waiting follow-up of the loop (`loop_closed`) in the same transaction.

const log = createLog("loops");

export interface LoopCommandDeps {
  db: DbOrTrx;
  now(): Date;
}

export interface LoopCommandInput {
  loopId: string;
  userId: string;
  via: LoopVia;
}

export type LoopAnswer =
  | { kind: "ok" }
  | { kind: "already" }
  | { kind: "limit_reached" }
  | { kind: "not_allowed" }
  | { kind: "not_found" };

export type LaterAnswer =
  | { kind: "ok"; dueAt: Date }
  | { kind: "closed" }
  | { kind: "limit_reached" }
  | { kind: "not_allowed" }
  | { kind: "feature_off" }
  | { kind: "not_found" };

// One Later tap moves the due date by this many working days, to the 17:00 of `defaultDue`.
export const LATER_WORKING_DAYS = 3;

export function inTransaction<T>(db: DbOrTrx, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// A log line of a command: ids and codes only (ADR 0024), never a loop text.
export function logCommand(ctx: TenantContext, loopId: string, command: string, kind: string, via: LoopVia): void {
  log.with({ org_id: ctx.orgId, loop_id: loopId }).info("loop_command", { command, kind, via });
}

export type Need = "member" | "owner";

// Any member of the organization, or an owner. Read inside the transaction of the command.
export async function mayAct(trx: Transaction<DB>, ctx: TenantContext, userId: string, need: Need): Promise<boolean> {
  const member = await getMembership(trx, ctx, userId);
  if (member === undefined) return false;
  return need === "member" || member.role === "owner";
}

// The common frame: the flag, the loop under its lock, the right of the user, then the rule of the command. A flag that
// is off hides the loops: the answer `off`.
async function runCommand<T extends { kind: string }>(
  deps: LoopCommandDeps,
  ctx: TenantContext,
  command: string,
  input: LoopCommandInput,
  need: Need,
  off: T,
  rule: (trx: Transaction<DB>, loop: LoopRow, now: Date) => Promise<T>
): Promise<T> {
  if (!(await isFeatureOn(deps.db, ctx, "open_loops"))) return off;
  const answer = await inTransaction(deps.db, async (trx): Promise<T | { kind: "not_found" | "not_allowed" }> => {
    const loop = await lockLoop(trx, ctx, input.loopId);
    if (loop === undefined) return { kind: "not_found" };
    if (!(await mayAct(trx, ctx, input.userId, need))) return { kind: "not_allowed" };
    return rule(trx, loop, deps.now());
  });
  logCommand(ctx, input.loopId, command, answer.kind, input.via);
  return answer as T;
}

const hidden: LoopAnswer = { kind: "not_found" };

// Closes an open loop for a command and ends its waiting follow-up. The caller holds the lock.
async function closeFor(
  trx: Transaction<DB>,
  ctx: TenantContext,
  loop: LoopRow,
  input: LoopCommandInput,
  reason: LoopCloseReason,
  now: Date
): Promise<LoopAnswer> {
  const closed = await closeLoop(trx, ctx, { loopId: loop.id, reason, userId: input.userId, via: input.via, at: now });
  if (closed !== "closed") return { kind: "already" };
  await expireFollowUpSends(trx, ctx, { mailboxId: loop.mailbox_id, loopId: loop.id }, now);
  return { kind: "ok" };
}

// Done: any member. An open loop closes `done`; a closed one answers `already`.
export function doneLoop(deps: LoopCommandDeps, ctx: TenantContext, input: LoopCommandInput): Promise<LoopAnswer> {
  return runCommand(deps, ctx, "done", input, "member", hidden, async (trx, loop, now) =>
    loop.status === "closed" ? { kind: "already" } : closeFor(trx, ctx, loop, input, "done", now)
  );
}

// Drop: an owner. An open loop closes `dropped`.
export function dropLoop(deps: LoopCommandDeps, ctx: TenantContext, input: LoopCommandInput): Promise<LoopAnswer> {
  return runCommand(deps, ctx, "drop", input, "owner", hidden, async (trx, loop, now) =>
    loop.status === "closed" ? { kind: "already" } : closeFor(trx, ctx, loop, input, "dropped", now)
  );
}

// Untrack: an owner, a `delegated` loop only (a hand forward that the user stops following).
export function untrackLoop(deps: LoopCommandDeps, ctx: TenantContext, input: LoopCommandInput): Promise<LoopAnswer> {
  return runCommand(deps, ctx, "untrack", input, "owner", hidden, async (trx, loop, now) => {
    if (loop.kind !== "delegated") return { kind: "not_allowed" };
    return loop.status === "closed" ? { kind: "already" } : closeFor(trx, ctx, loop, input, "untracked", now);
  });
}

// Later: any member. A `waiting` or `delegated` loop moves its due date to 3 working days after the later of the due
// date and now, at 17:00 local time; three uses at most (`limit_reached`). A `promised` loop has no Later.
export function laterLoop(deps: LoopCommandDeps, ctx: TenantContext, input: LoopCommandInput): Promise<LaterAnswer> {
  return runCommand<LaterAnswer>(
    deps,
    ctx,
    "later",
    input,
    "member",
    { kind: "feature_off" },
    async (trx, loop, now): Promise<LaterAnswer> => {
      if (loop.status === "closed") return { kind: "closed" };
      if (loop.kind === "promised") return { kind: "not_allowed" };
      if (loop.later_count >= MAX_LATER) return { kind: "limit_reached" };
      const organization = await getOrganization(trx, ctx);
      const from = new Date(Math.max(loop.due_at.getTime(), now.getTime()));
      const dueAt = defaultDue(from, LATER_WORKING_DAYS, organization?.timezone ?? "UTC");
      const done = await setLoopLater(trx, ctx, {
        loopId: loop.id,
        dueAt,
        userId: input.userId,
        via: input.via,
        at: now,
      });
      return done === "ok" ? { kind: "ok", dueAt } : { kind: done };
    }
  );
}

// Reopen: an owner. A closed loop with its texts opens again with its old due date; the wait starts again at `now`, so the
// reply that closed it does not close it a second time. A `sent_off` or cleared loop has nothing to show: `not_allowed`.
// "Track my sent mail" must be on: its state row is locked first (the order of `onSentOff`), then the loop.
export async function reopenLoop(
  deps: LoopCommandDeps,
  ctx: TenantContext,
  input: LoopCommandInput
): Promise<LoopAnswer> {
  if (!(await isFeatureOn(deps.db, ctx, "open_loops"))) return hidden;
  const known = await getLoop(deps.db, ctx, input.loopId);
  if (known === undefined) return { kind: "not_found" };
  const answer = await inTransaction(deps.db, async (trx): Promise<LoopAnswer> => {
    const tracking = await lockSentSyncState(trx, ctx, known.mailbox_id);
    const loop = await lockLoop(trx, ctx, input.loopId);
    if (loop === undefined) return { kind: "not_found" };
    if (!(await mayAct(trx, ctx, input.userId, "owner"))) return { kind: "not_allowed" };
    if (loop.status === "open") return { kind: "already" };
    if (loop.close_reason === "sent_off" || tracking?.enabled !== true) return { kind: "not_allowed" };
    const now = deps.now();
    const result = await reopenLoopRow(trx, ctx, {
      loopId: loop.id,
      userId: input.userId,
      via: input.via,
      waitFromAt: now,
      at: now,
    });
    return { kind: result };
  });
  logCommand(ctx, input.loopId, "reopen", answer.kind, input.via);
  return answer;
}
