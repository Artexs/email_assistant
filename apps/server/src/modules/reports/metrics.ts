// The week service (F100 D19): one organization, one week, every metric. It reads and writes nothing.
import {
  barCategories,
  buildWeekStats,
  lastFinishedWeek,
  matchSender,
  parseCategoryPolicy,
  previousWeekStart,
  weekRange,
  type GateRow,
  type HiddenMoveRow,
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
import { listMailboxes, type TestMailRule } from "../mail";
import { getOrganization } from "../tenancy";
import { listHandledRows, listTruthRows, realGoNoGoRows } from "../triage";

type DbOrTrx = Db | Transaction<DB>;

export type UrgentNoticeReader = (db: DbOrTrx, ctx: TenantContext, q: WeekQuery) => Promise<UrgentNoticeRow[]>;

export interface WeekStatsDeps {
  /** The M5 reader of `channels` (`listUrgentNoticeTimes`); the composition root fills it, `reports` may not import `channels`. */
  urgentNotices: UrgentNoticeReader;
  testMail: TestMailRule;
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
    const { mailboxId: _mailboxId, fromAddress, ...row } = move;
    result.push({ ...row, whitelisted: matchSender(fromAddress, rules).whitelisted });
  }
  return result;
}

// M8: the evidence of each bar category of each mailbox in scope, as it is at `now`.
async function gateRows(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxes: readonly MailboxScope[],
  now: Date,
  testMail: TestMailRule
): Promise<GateRow[]> {
  const rows: GateRow[] = [];
  for (const mailbox of mailboxes) {
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
      });
    }
  }
  return rows;
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
  const [truth, delegations, moves, rejects, mistakes, handled, urgent, llmCalls] = await Promise.all([
    listTruthRows(db, ctx, q),
    listDelegationDueRows(db, ctx, q),
    listHiddenMoveRows(db, ctx, q),
    listRejectRows(db, ctx, q),
    listMistakeRows(db, ctx, q),
    listHandledRows(db, ctx, q),
    deps.urgentNotices(db, ctx, q),
    listLlmCallRows(db, ctx, { range: q.range, mailboxId: q.mailboxId }),
  ]);
  const gates = input.withEvidence === false ? [] : await gateRows(db, ctx, scope, input.now, deps.testMail);
  return buildWeekStats(
    {
      truth,
      delegations,
      moves: await withWhitelist(db, ctx, moves),
      rejects,
      mistakes,
      handled,
      urgent,
      llmCalls,
      gates,
      mailboxes: scope.filter((mailbox) => mailbox.status === "active").length,
    },
    { weekStart: input.weekStart, mailboxId: input.mailboxId, timeZone, now: input.now }
  );
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
