import { defaultDue, sentSkipReason } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { hasOpenDelegationInThread } from "../delegation";
import { getSentSyncState, lockSentSyncState } from "../mail";

import { type AnalysisSkipReason, type SentCandidate, writeAnalysis } from "./analysis-repo";
import { FOLLOW_UP_MIN_WAIT_DAYS } from "./hooks";
import { openLoopsByThread } from "./list";
import { closeLoop, lockLoop, restartLoop, type DbOrTrx } from "./repo";

// The rules of the Sent analysis that need no LLM call: the promise rule, the thread rule, the delegation rule and the
// code filters. Each candidate runs them in one transaction.

// What a run knows about one mailbox. Read once per run.
export interface MailboxEnv {
  mailboxId: string;
  // The addresses of every mailbox of the organization, lower case.
  ownAddresses: readonly string[];
  timeZone: string;
  // `mailbox_settings.loop_wait_days`.
  waitDays: number;
  // The active delegates of the organization: the address is lower case.
  delegates: readonly { id: string; email: string }[];
  now: Date;
}

export type RulesOutcome =
  // The row got its analysis row (`skipped`). `restarted`: waits that the thread rule restarted.
  | { kind: "skipped"; reason: AnalysisSkipReason; restarted: number; promisesClosed: number }
  // The rules let the row go on to the model.
  | { kind: "call"; promisesClosed: number }
  // "Track my sent mail" is off: nothing is written.
  | { kind: "off" };

export const lowerAll = (addresses: readonly string[]): string[] => addresses.map((address) => address.toLowerCase());

// Runs `run` in a transaction, or in the one the caller holds (a test).
export function inTransaction<T>(db: DbOrTrx, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// The first lock of every write of this job is the state row of "Track my sent mail", the same first lock as the switch
// (`setSentSync`), the Sent pass and `onSentOff`; the loops follow. So the order is the same everywhere, and a switch that
// turns the tracking off waits for a write that runs now and then closes the loop that it opened.
export async function lockSentTracking(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  return (await lockSentSyncState(trx, ctx, mailboxId))?.enabled === true;
}

// Open `promised` loops of the mailbox that the user opened before `before`, whose counterpart is one of `addresses`.
async function promisesTo(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  addresses: readonly string[],
  before: Date
): Promise<string[]> {
  if (addresses.length === 0) return [];
  const rows = await trx
    .selectFrom("open_loops")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("kind", "=", "promised")
    .where("status", "=", "open")
    .where("wait_from_at", "<", before)
    .where(sql<string>`lower(counterpart)`, "in", [...addresses])
    .orderBy("id")
    .execute();
  return rows.map((row) => row.id);
}

// A later mail of the user to the counterpart of a promise closes it, in any thread. The loops are locked in id order.
async function closePromises(
  trx: Transaction<DB>,
  ctx: TenantContext,
  env: MailboxEnv,
  row: SentCandidate
): Promise<number> {
  const ids = await promisesTo(trx, ctx, env.mailboxId, lowerAll([...row.to, ...row.cc]), row.sentAt);
  let closed = 0;
  for (const loopId of ids) {
    const loop = await lockLoop(trx, ctx, loopId);
    if (loop === undefined || loop.status !== "open" || loop.wait_from_at >= row.sentAt) continue;
    if ((await closeLoop(trx, ctx, { loopId, reason: "later_reply", at: env.now })) === "closed") closed += 1;
  }
  return closed;
}

// A mail in the thread of an open `waiting` or `delegated` loop, newer than its wait, to a person of the loop (To or Cc):
// the wait starts again. A mail to other people is a side note: it goes on to the model.
async function restartWaits(
  trx: Transaction<DB>,
  ctx: TenantContext,
  env: MailboxEnv,
  row: SentCandidate
): Promise<number> {
  const recipients = new Set(lowerAll([...row.to, ...row.cc]));
  const candidates = (await openLoopsByThread(trx, ctx, env.mailboxId, [row.threadKey]))
    .filter((loop) => loop.kind === "waiting" || loop.kind === "delegated")
    .filter((loop) => loop.wait_from_at < row.sentAt)
    .filter((loop) => lowerAll([...loop.to_addresses, ...loop.cc_addresses]).some((address) => recipients.has(address)))
    .map((loop) => loop.id)
    .sort();
  const dueAt = defaultDue(row.sentAt, Math.max(env.waitDays, FOLLOW_UP_MIN_WAIT_DAYS), env.timeZone);
  let restarted = 0;
  for (const loopId of candidates) {
    const loop = await lockLoop(trx, ctx, loopId);
    if (loop === undefined || loop.status !== "open" || loop.wait_from_at >= row.sentAt) continue;
    const done = await restartLoop(trx, ctx, {
      loopId,
      sentEmailId: row.id,
      messageId: row.messageId,
      referencesIds: row.referencesIds,
      waitFrom: row.sentAt,
      dueAt,
    });
    if (done) restarted += 1;
  }
  return restarted;
}

// The first rule that hits wins, after the promise rule, which never ends the row.
export async function applyRules(
  db: DbOrTrx,
  ctx: TenantContext,
  env: MailboxEnv,
  row: SentCandidate
): Promise<RulesOutcome> {
  return inTransaction(db, async (trx) => {
    if (!(await lockSentTracking(trx, ctx, env.mailboxId))) return { kind: "off" };
    const promisesClosed = await closePromises(trx, ctx, env, row);
    const skip = async (reason: AnalysisSkipReason, restarted = 0): Promise<RulesOutcome> => {
      await writeAnalysis(trx, ctx, {
        mailboxId: env.mailboxId,
        sentEmailId: row.id,
        write: { status: "skipped", skipReason: reason },
        at: env.now,
      });
      return { kind: "skipped", reason, restarted, promisesClosed };
    };

    const restarted = await restartWaits(trx, ctx, env, row);
    if (restarted > 0) return skip("thread_restart", restarted);
    // A delegation of the delegation module: its chaser keeps the chase of that thread.
    if (await hasOpenDelegationInThread(trx, ctx, env.mailboxId, row.threadKey)) return skip("delegation_thread");

    // `pending` rows are not candidates; a `stored` row has its text here.
    const reason = sentSkipReason({
      actionId: row.actionId,
      content: row.content,
      bodyText: row.bodyText,
      sentAt: row.sentAt,
      to: row.to,
      cc: row.cc,
      listId: row.listId,
      autoSubmitted: row.autoSubmitted,
      hasCalendar: row.hasCalendar,
      ownAddresses: env.ownAddresses,
      now: env.now,
    });
    if (reason !== null) return skip(reason);
    return { kind: "call", promisesClosed };
  });
}

// For a caller that needs the state without a lock (a reader): "Track my sent mail" is on.
export async function sentTrackingOn(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  return (await getSentSyncState(db, ctx, mailboxId))?.enabled === true;
}
