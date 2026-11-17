import { randomUUID } from "node:crypto";

import { localDateTime, parseToolSwitches } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import { getMailboxSettings, lockSettingsForShare } from "../config";
import {
  CHASER_LOCAL_TIME,
  CHASER_SET_LIMIT,
  chaserDay,
  chaserRanToday,
  createReminderSet,
  isDelegateActive,
  lockChaserDay,
  logDelegationRunDone,
  planDelegationReminders,
  recordDelegationRun,
} from "../delegation";
import { getOrganization, isFeatureOn, isOrgSuspended } from "../tenancy";

import { followUpOffered, judgeFollowUp, planFollowUpPair } from "./follow-up-draft";
import { expireFollowUpSends } from "./follow-up-expiry";
import { closeLoop, SYSTEM, toLoopRow, type DbOrTrx, type LoopRow } from "./repo";

// F116 stage 15: the one chaser. It replaces the job `delegation.chaser`: once per local day per mailbox, from
// 07:30 local time, in one transaction after the settings share lock and the version compare (the settings snapshot rule): the delegation part
// (`planDelegationReminders`), then the loop part below, then the approval set of the delegation reminders.
//
// The loop part (every rule of the day):
//   (a) a `delegated` loop past due, open, no waiting follow-up, fewer than 2 sent, 3 working days since the last, not
//       suspicious: a follow-up pair (the planning core of the Draft command, actor `system`). `assist` and drafts on.
//   (b) a `waiting` loop: the same, only with the switch `auto_follow_up` (PD-120, off by default).
//   (c) `stale`: a `waiting` or `delegated` loop with 2 follow-ups sent and the last one 14 days ago, or due 30 days ago.
//   (d) `expired`: a `promised` loop 7 days past due.
// (c) and (d) run in every mode and close the loop; (a) and (b) plan nothing in `shadow`. Each follow-up is its own card:
// a follow-up never joins an approval set. At most `MAX_PLANNED` sends per mailbox and run in total, the
// delegation reminders first; the rest waits for the next day.
//
// Locks: the settings row (share), the advisory day lock, then every candidate loop in ascending id order (one
// statement, `FOR UPDATE`, the order that `onSentOff` uses), then the sends of a loop. The delegation rows come before the
// loops and no other code locks a loop and then a delegation of the chaser.

const log = createLog("loops");

export const MAX_PLANNED = CHASER_SET_LIMIT;
// A promised loop ends `expired` this long after its due date, a loop that nobody answered ends `stale` after these.
export const PROMISE_GRACE_DAYS = 7;
export const STALE_AFTER_LAST_FOLLOW_UP_DAYS = 14;
export const STALE_AFTER_DUE_DAYS = 30;
const DAY_MS = 24 * 3_600_000;
// Loops that one run reads. A loop that is not ready (too soon, a card waits) stays a candidate, so a very long list can hide the
// newest ones for a day: the next run reads the same oldest-first part again, and every planned or closed loop leaves it.
const CANDIDATE_BATCH = 500;

export interface LoopChaserDeps {
  db: DbOrTrx;
  now(): Date;
}

export type LoopChaserSkip = "gate" | "settings" | "suspended" | null;

export interface LoopChaserResult {
  skipped: LoopChaserSkip;
  // The delegation part.
  due: number;
  overdue: number;
  reminders: number;
  // The loop part: follow-up cards planned, loops closed `stale`, loops closed `expired`.
  followUps: number;
  stale: number;
  expired: number;
}

const skip = (skipped: Exclude<LoopChaserSkip, null>): LoopChaserResult => ({
  skipped,
  due: 0,
  overdue: 0,
  reminders: 0,
  followUps: 0,
  stale: 0,
  expired: 0,
});

// The raw switch: the core schema of the tool switches does not hold `auto_follow_up` yet (stage 22 adds it to the
// panel), and its parse drops an unknown key. Only a JSON `true` counts.
export function autoFollowUpOn(toolSwitches: unknown): boolean {
  return (
    typeof toolSwitches === "object" &&
    toolSwitches !== null &&
    (toolSwitches as Record<string, unknown>).auto_follow_up === true
  );
}

export type LoopFate = "expire" | "stale" | "follow_up" | "none";

// What the rules say about one locked, open loop. Pure: the dates and the counters only.
export function loopFate(
  loop: Pick<LoopRow, "kind" | "due_at" | "follow_ups_sent" | "last_follow_up_at">,
  now: Date,
  opts: { followUps: boolean }
): LoopFate {
  const at = now.getTime();
  if (loop.kind === "promised") return loop.due_at.getTime() + PROMISE_GRACE_DAYS * DAY_MS <= at ? "expire" : "none";
  const afterDue = loop.due_at.getTime() + STALE_AFTER_DUE_DAYS * DAY_MS <= at;
  const afterLast =
    loop.follow_ups_sent >= 2 &&
    loop.last_follow_up_at !== null &&
    loop.last_follow_up_at.getTime() + STALE_AFTER_LAST_FOLLOW_UP_DAYS * DAY_MS <= at;
  if (afterDue || afterLast) return "stale";
  if (opts.followUps && loop.due_at.getTime() <= at && loop.follow_ups_sent < 2) return "follow_up";
  return "none";
}

interface LoopPartInput {
  mailboxId: string;
  now: Date;
  // How many sends the loop part may plan (the delegation reminders came first).
  budget: number;
  // `assist` with drafts on: the follow-up rules (a) and (b) may plan.
  assist: boolean;
  autoFollowUp: boolean;
}

interface LoopPartResult {
  followUps: number;
  stale: number;
  expired: number;
}

// The loops that this run may touch, locked in ascending id order by one statement. Postgres checks the WHERE again after a
// wait for a lock: a loop that a command closed in the meantime drops out.
async function lockCandidates(trx: Transaction<DB>, ctx: TenantContext, input: LoopPartInput): Promise<LoopRow[]> {
  const { now } = input;
  const before = (days: number): Date => new Date(now.getTime() - days * DAY_MS);
  const rows = await trx
    .selectFrom("open_loops")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", input.mailboxId)
    .where("status", "=", "open")
    .where((eb) =>
      eb.or([
        eb.and([eb("kind", "=", "promised"), eb("due_at", "<=", before(PROMISE_GRACE_DAYS))]),
        eb.and([
          eb("kind", "in", ["waiting", "delegated"]),
          eb.or([
            eb("due_at", "<=", before(STALE_AFTER_DUE_DAYS)),
            eb.and([
              eb("follow_ups_sent", ">=", 2),
              eb("last_follow_up_at", "<=", before(STALE_AFTER_LAST_FOLLOW_UP_DAYS)),
            ]),
            eb.and([eb("due_at", "<=", now), eb("follow_ups_sent", "<", 2)]),
          ]),
        ]),
      ])
    )
    .orderBy("id")
    .limit(CANDIDATE_BATCH)
    .forUpdate()
    .execute();
  return rows.map(toLoopRow);
}

async function closeFor(
  trx: Transaction<DB>,
  ctx: TenantContext,
  loop: LoopRow,
  reason: "stale" | "expired",
  now: Date
) {
  if ((await closeLoop(trx, ctx, { loopId: loop.id, reason, at: now })) !== "closed") return false;
  await expireFollowUpSends(trx, ctx, { mailboxId: loop.mailbox_id, loopId: loop.id }, now);
  return true;
}

// The loop part, in the caller's transaction (the settings share lock and the day lock are held).
export async function runLoopPart(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: LoopPartInput
): Promise<LoopPartResult> {
  const { now } = input;
  const result: LoopPartResult = { followUps: 0, stale: 0, expired: 0 };
  const locked = await lockCandidates(trx, ctx, input);
  const followUps: LoopRow[] = [];
  for (const loop of locked) {
    const fate = loopFate(loop, now, {
      followUps: input.assist && (loop.kind === "delegated" || input.autoFollowUp),
    });
    if (fate === "expire" || fate === "stale") {
      if (await closeFor(trx, ctx, loop, fate === "expire" ? "expired" : "stale", now))
        result[fate === "expire" ? "expired" : "stale"] += 1;
    } else if (fate === "follow_up") {
      followUps.push(loop);
    }
  }
  // The oldest due date first; the locks are all taken already, so the order here cannot deadlock.
  followUps.sort((a, b) => a.due_at.getTime() - b.due_at.getTime() || (a.id < b.id ? -1 : 1));
  for (const loop of followUps) {
    if (result.followUps >= input.budget) break;
    if (await followUp(trx, ctx, loop, now)) result.followUps += 1;
  }
  return result;
}

// One loop: the rules of the Draft command (`judgeFollowUp`), the chaser's own rules, then the pair. False: nothing planned.
async function followUp(trx: Transaction<DB>, ctx: TenantContext, loop: LoopRow, now: Date): Promise<boolean> {
  // A disabled or erased delegate gets no follow-up (like the reminders of a delegation).
  if (
    loop.kind === "delegated" &&
    (loop.delegate_id === null || !(await isDelegateActive(trx, ctx, loop.delegate_id)))
  ) {
    return false;
  }
  const verdict = await judgeFollowUp(trx, ctx, loop, now);
  if (verdict.kind !== "go") return false;
  // The job offers each follow-up number once. A card that was rejected, expired or failed (with an unknown outcome
  // the mail may have gone out) is not offered again by the job; the user can still tap Draft.
  if (await followUpOffered(trx, ctx, loop.id, verdict.n)) return false;
  return (await planFollowUpPair(trx, ctx, loop, verdict.n, { actor: SYSTEM, via: "chaser", now })) !== undefined;
}

// The chaser for one mailbox. `now` is the clock of the run; `force` skips the 07:30 gate and the once-per-day gate.
export async function runLoopChaser(
  deps: LoopChaserDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; force?: boolean }
): Promise<LoopChaserResult> {
  const { now } = opts;
  const force = opts.force === true;
  const settings = await getMailboxSettings(deps.db, ctx, mailboxId);
  const organization = await getOrganization(deps.db, ctx);
  if (settings === undefined || organization === undefined) return skip("settings");
  const tz = organization.timezone;
  const loopsOn = await isFeatureOn(deps.db, ctx, "open_loops");
  const assist = settings.mode === "assist" && parseToolSwitches(settings.tool_switches).create_draft;
  // The delegation part keeps its gate: `assist` with drafts on. The loop part closes in every mode when the flag is on.
  if (!assist && !loopsOn) return skip("settings");
  if (!force && localDateTime(now, tz).time < CHASER_LOCAL_TIME) return skip("gate");

  const ranToday = (db: DbOrTrx, event: string): Promise<boolean> =>
    chaserRanToday(db, ctx, { event, mailboxId, now, timeZone: tz });
  const wanted = async (db: DbOrTrx, flagOn: boolean) => ({
    delegation: assist && (force || !(await ranToday(db, auditEvents.delegationChaserRun))),
    loops: flagOn && (force || !(await ranToday(db, auditEvents.loopsChaserRun))),
  });
  const first = await wanted(deps.db, loopsOn);
  if (!first.delegation && !first.loops) return skip("gate");

  const { day } = chaserDay(now, tz);
  const setId = randomUUID();
  const run = async (trx: Transaction<DB>): Promise<LoopChaserResult> => {
    // The first statement of the transaction. A setter waits for this transaction, or this one sees the setter's commit.
    const version = await lockSettingsForShare(trx, ctx, mailboxId);
    if (version === undefined || version !== settings.version) return skip("settings");
    // A suspend that came during the run: nothing is written.
    if (await isOrgSuspended(trx, ctx)) return skip("suspended");
    await lockChaserDay(trx, mailboxId);
    // The gate again under the lock: a run that went first has committed its marker.
    const part = await wanted(trx, await isFeatureOn(trx, ctx, "open_loops"));
    if (!part.delegation && !part.loops) return skip("gate");

    const out: LoopChaserResult = {
      skipped: null,
      due: 0,
      overdue: 0,
      reminders: 0,
      followUps: 0,
      stale: 0,
      expired: 0,
    };
    let pairs: Awaited<ReturnType<typeof planDelegationReminders>>["pairs"] = [];
    if (part.delegation) {
      const plan = await planDelegationReminders(trx, ctx, mailboxId, { now, limit: MAX_PLANNED });
      pairs = plan.pairs;
      out.due = plan.due;
      out.overdue = plan.overdue;
    }
    if (part.loops) {
      const loops = await runLoopPart(trx, ctx, {
        mailboxId,
        now,
        budget: MAX_PLANNED - pairs.length,
        assist,
        autoFollowUp: autoFollowUpOn(settings.tool_switches),
      });
      out.followUps = loops.followUps;
      out.stale = loops.stale;
      out.expired = loops.expired;
    }
    if (part.delegation) {
      out.reminders = await createReminderSet(trx, ctx, pairs, { setId, day, now });
      await recordDelegationRun(trx, ctx, {
        mailboxId,
        due: out.due,
        overdue: out.overdue,
        reminders: out.reminders,
        setId,
        forced: force,
        now,
      });
    }
    if (part.loops) {
      await recordAudit(trx, ctx, {
        actor: SYSTEM,
        event: auditEvents.loopsChaserRun,
        data: {
          mailbox_id: mailboxId,
          follow_ups: out.followUps,
          stale: out.stale,
          expired: out.expired,
          forced: force,
        },
        at: now,
      });
    }
    return out;
  };
  const result = deps.db.isTransaction
    ? await run(deps.db as Transaction<DB>)
    : await deps.db.transaction().execute(run);

  if (result.skipped === null) {
    if (assist)
      logDelegationRunDone({ mailboxId, due: result.due, overdue: result.overdue, reminders: result.reminders });
    logLoopChaserDone(ctx, mailboxId, result);
  }
  return result;
}

// The lines after the commit: ids and counts only. `count` is the number of follow-up cards planned (the delegation part has its own line `chaser_done`); `stale` and `expired` are their own lines.
function logLoopChaserDone(ctx: TenantContext, mailboxId: string, result: LoopChaserResult): void {
  const line = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
  if (result.followUps > 0) line.info("loops_chaser_done", { count: result.followUps });
  if (result.stale > 0) line.info("loops_chaser_done", { count: result.stale, kind: "stale" });
  if (result.expired > 0) line.info("loops_chaser_done", { count: result.expired, kind: "expired" });
}
