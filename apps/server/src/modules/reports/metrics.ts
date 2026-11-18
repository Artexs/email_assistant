// The week service: one organization, one week, every metric. It reads and writes nothing.
import {
  barCategories,
  buildWeekStats,
  handledShare,
  lastFinishedWeek,
  matchSender,
  openLoopsOnTime,
  parseCategoryPolicy,
  previousWeekStart,
  seriousMistakes,
  totalsOf,
  unitCost,
  urgentLatency,
  weekRange,
  type Category,
  type GateRow,
  type HandledShare,
  type HiddenMoveRow,
  type OpenLoopsOnTime,
  type SeriousMistakes,
  type TrustEvidenceRows,
  type UnitCost,
  type UrgentLatency,
  type UrgentNoticeRow,
  type WeekQuery,
  type WeekStats,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { listHiddenMoveRows, listMistakeRows, listRejectRows } from "../actions";
import { listLlmCallRows } from "../audit";
import { getMailboxSettings, listSenderRules } from "../config";
import { listDelegationDueRows } from "../delegation";
import { loopDueRows } from "../loops";
import { listMailboxes, type TestMailRule } from "../mail";
import { getOrganization, isFeatureOn } from "../tenancy";
import { listHandledRows, listTruthRows, realGoNoGoRows } from "../triage";

type DbOrTrx = Db | Transaction<DB>;

export type UrgentNoticeReader = (db: DbOrTrx, ctx: TenantContext, q: WeekQuery) => Promise<UrgentNoticeRow[]>;

/**
 * The M8 reader of `trust` (`trustViewFor`): the three evidence sources of one mailbox. `null`: the mailbox is not the organization's.
 * `reports` (layer 4) may not import `trust` (layer 5): the composition root fills it.
 */
export type TrustEvidenceReader = (ctx: TenantContext, mailboxId: string) => Promise<TrustEvidenceRows | null>;

export interface WeekStatsDeps {
  /** The M5 reader of `channels` (`listUrgentNoticeTimes`); the composition root fills it, `reports` may not import `channels`. */
  urgentNotices: UrgentNoticeReader;
  testMail: TestMailRule;
  /** M8 only. Absent, or the flag `trust_ladder` off: the three evidence keys of an M8 row are null. */
  trustEvidence?: TrustEvidenceReader;
}

interface MailboxScope {
  id: string;
  status: string;
}

// The sender rules are read once per mailbox: a move row carries its mailbox.
async function withWhitelist(
  db: DbOrTrx,
  ctx: TenantContext,
  moves: Awaited<ReturnType<typeof listHiddenMoveRows>>
): Promise<HiddenMoveRow[]> {
  const rulesByMailbox = new Map<string, Awaited<ReturnType<typeof listSenderRules>>>();
  const result: HiddenMoveRow[] = [];
  for (const move of moves) {
    let rules = rulesByMailbox.get(move.mailboxId);
    if (rules === undefined) {
      rules = await listSenderRules(db, ctx, move.mailboxId);
      rulesByMailbox.set(move.mailboxId, rules);
    }
    result.push({
      emailId: move.emailId,
      appliedAt: move.appliedAt,
      folder: move.folder,
      truth: move.truth,
      vip: move.vip,
      whitelisted: matchSender(move.fromAddress, rules).whitelisted,
    });
  }
  return result;
}

// M8: the evidence of each bar category of each mailbox in scope, as it is at `now`.
async function gateRows(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxes: readonly MailboxScope[],
  now: Date,
  deps: WeekStatsDeps
): Promise<GateRow[]> {
  const { testMail } = deps;
  const rows: GateRow[] = [];
  // The flag is read once: with it off, no mailbox reads the trust data and the three keys stay null.
  const trustOn = deps.trustEvidence !== undefined && (await isFeatureOn(db, ctx, "trust_ladder"));
  for (const mailbox of mailboxes) {
    const trust = trustOn ? await deps.trustEvidence?.(ctx, mailbox.id) : null;
    const report = await realGoNoGoRows(db, ctx, mailbox.id, now, testMail);
    const settings = await getMailboxSettings(db, ctx, mailbox.id);
    const policy = parseCategoryPolicy(settings?.category_policy ?? {});
    for (const category of barCategories) {
      const row = report[category];
      rows.push({
        mailboxId: mailbox.id,
        category,
        auto: policy[category]?.auto ?? false,
        kept: row.kept,
        precision: row.precision,
        recall: row.recall,
        decision: row.decision,
        global: trust?.[category].global ?? null,
        history: trust?.[category].history ?? null,
        trip: trust?.[category].trip ?? null,
      });
    }
  }
  return rows;
}

function delegationsOnTime(
  delegations: Awaited<ReturnType<typeof listDelegationDueRows>>,
  range: { start: Date; end: Date },
  timeZone: string,
  now: Date
): OpenLoopsOnTime {
  return totalsOf(openLoopsOnTime({ delegations, loops: [] }, { range, timeZone, now }));
}

/** The rows of every reader for one query; `llmRange` (default the query range) is the window of the M7 reader. */
async function readMetricRows(
  db: DbOrTrx,
  ctx: TenantContext,
  q: WeekQuery,
  deps: WeekStatsDeps,
  opts: { llmRange?: { start: Date; end: Date }; withLoops: boolean }
) {
  const llmRange = opts.llmRange ?? q.range;
  // Loops are read only for an organization with the flag `open_loops` on: off, the loops are hidden.
  const loopsOn = opts.withLoops && (await isFeatureOn(db, ctx, "open_loops"));
  const [truth, delegations, loops, moves, rejects, mistakes, handled, urgent, llmCalls] = await Promise.all([
    listTruthRows(db, ctx, q),
    listDelegationDueRows(db, ctx, q),
    loopsOn ? loopDueRows(db, ctx, { range: q.range, mailboxId: q.mailboxId, testMail: q.testMail }) : null,
    listHiddenMoveRows(db, ctx, q),
    listRejectRows(db, ctx, q),
    listMistakeRows(db, ctx, q),
    listHandledRows(db, ctx, q),
    deps.urgentNotices(db, ctx, q),
    listLlmCallRows(db, ctx, { range: llmRange, mailboxId: q.mailboxId }),
  ]);
  return { truth, delegations, loops, moves, rejects, mistakes, handled, urgent, llmCalls };
}

/** One week of one organization; `mailboxId` null = all mailboxes. `not_found` when the mailbox is not the organization's. */
export async function weekStats(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { weekStart: string; mailboxId: string | null; now: Date; withEvidence?: boolean },
  deps: WeekStatsDeps
): Promise<WeekStats | "not_found"> {
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) return "not_found";
  const all = await listMailboxes(db, ctx);
  const scope = input.mailboxId === null ? all : all.filter((mailbox) => mailbox.id === input.mailboxId);
  if (input.mailboxId !== null && scope.length === 0) return "not_found";

  const timeZone = organization.timezone;
  const q: WeekQuery = {
    range: weekRange(input.weekStart, timeZone),
    mailboxId: input.mailboxId,
    testMail: deps.testMail,
  };
  const rows = await readMetricRows(db, ctx, q, deps, { withLoops: true });
  const gates = input.withEvidence === false ? [] : await gateRows(db, ctx, scope, input.now, deps);
  return buildWeekStats(
    {
      truth: rows.truth,
      delegations: rows.delegations,
      loops: rows.loops,
      moves: await withWhitelist(db, ctx, rows.moves),
      rejects: rows.rejects,
      mistakes: rows.mistakes,
      handled: rows.handled,
      urgent: rows.urgent,
      llmCalls: rows.llmCalls,
      gates,
      mailboxes: scope.filter((mailbox) => mailbox.status === "active").length,
    },
    { weekStart: input.weekStart, mailboxId: input.mailboxId, timeZone, now: input.now }
  );
}

export interface RangeMetricsInput {
  /** `start ≤ t < end`. M2 to M5 read this range. */
  range: { start: Date; end: Date };
  mailboxId: string;
  now: Date;
  /**
   * M7 reads `llmRange` (default `range`). The calls between its end and the end of `range` are the "tail": their cost is
   * returned apart (`tailLlm`), and never enters the monthly figure of M7.
   */
  llmRange?: { start: Date; end: Date };
  /** The truth of a mail by email id, for a hidden move whose truth the feedback reader does not know (the lab knows its slots). */
  truth?: ReadonlyMap<string, Category>;
}

export interface RangeMetrics {
  m2: OpenLoopsOnTime;
  m3: SeriousMistakes;
  m4: HandledShare;
  m5: UrgentLatency;
  m7: UnitCost;
  /** The cost of the calls in `range` after the end of `llmRange`; null when `llmRange` was not given. */
  tailLlm: { usd: number; calls: number; unpricedCalls: number } | null;
  /** The rows behind M5: urgent mail of the range and its first notice time. */
  urgent: UrgentNoticeRow[];
}

/**
 * M2 to M5 and M7 for any range of one mailbox (the E2b live lab: a run window is not a week). The same readers and the
 * same core functions as `weekStats`; nothing here defines a formula. `not_found` when the mailbox is not the organization's.
 */
export async function rangeMetrics(
  db: DbOrTrx,
  ctx: TenantContext,
  input: RangeMetricsInput,
  deps: WeekStatsDeps
): Promise<RangeMetrics | "not_found"> {
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) return "not_found";
  const mailboxes = (await listMailboxes(db, ctx)).filter((mailbox) => mailbox.id === input.mailboxId);
  if (mailboxes.length === 0) return "not_found";

  const timeZone = organization.timezone;
  const q: WeekQuery = { range: input.range, mailboxId: input.mailboxId, testMail: deps.testMail };
  const llmRange = input.llmRange ?? input.range;
  // One read of the whole range; the M7 window is a cut of it, so a call is in exactly one of the two parts.
  const rows = await readMetricRows(db, ctx, q, deps, {
    llmRange: {
      start: input.range.start,
      end: new Date(Math.max(input.range.end.getTime(), llmRange.end.getTime())),
    },
    withLoops: false,
  });
  const inWindow = rows.llmCalls.filter(
    (call) => call.at.getTime() >= llmRange.start.getTime() && call.at.getTime() < llmRange.end.getTime()
  );
  const tail = rows.llmCalls.filter(
    (call) => call.at.getTime() >= llmRange.end.getTime() && call.at.getTime() < input.range.end.getTime()
  );
  const moves = (await withWhitelist(db, ctx, rows.moves)).map((move) =>
    move.truth === null ? { ...move, truth: input.truth?.get(move.emailId) ?? null } : move
  );
  const active = mailboxes.filter((mailbox) => mailbox.status === "active").length;
  const tailCost = input.llmRange === undefined ? null : unitCost(tail, { mailboxes: active });
  return {
    // The live lab scores delegations: its totals keep the meaning of F4, with no split.
    m2: delegationsOnTime(rows.delegations, input.range, timeZone, input.now),
    m3: seriousMistakes({ moves, rejects: rows.rejects, mistakes: rows.mistakes }, input.range),
    m4: handledShare(rows.handled),
    m5: urgentLatency(rows.urgent, { timeZone }),
    m7: unitCost(inWindow, { mailboxes: active }),
    tailLlm:
      tailCost === null
        ? null
        : { usd: tailCost.llmUsdWeek, calls: tailCost.llmCalls, unpricedCalls: tailCost.unpricedCalls },
    urgent: rows.urgent,
  };
}

/** The last `weeks` finished weeks at `now`, newest first. Only the newest week carries M8 (the evidence of today). */
export async function recentWeekStats(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { weeks: number; mailboxId: string | null; now: Date },
  deps: WeekStatsDeps
): Promise<WeekStats[] | "not_found"> {
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) return "not_found";
  let weekStart = lastFinishedWeek(input.now, organization.timezone);
  const result: WeekStats[] = [];
  for (let i = 0; i < input.weeks; i += 1) {
    const stats = await weekStats(
      db,
      ctx,
      { weekStart, mailboxId: input.mailboxId, now: input.now, withEvidence: i === 0 },
      deps
    );
    if (stats === "not_found") return "not_found";
    result.push(stats);
    weekStart = previousWeekStart(weekStart);
  }
  return result;
}
