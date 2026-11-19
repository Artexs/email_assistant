// The one place that turns the rows of a week into a WeekStats.
import type { WeekStats } from "../web/stats";
import { weekStatsSchema } from "../web/stats";

import { type MailTruthRow, missedImportant } from "./m1";
import { type DelegationDueRow, type LoopDueRow, openLoopsOnTime } from "./m2";
import { type HiddenMoveRow, type MistakeRow, type RejectRow, seriousMistakes } from "./m3";
import { type HandledRow, handledShare } from "./m4";
import { type UrgentNoticeRow, urgentLatency } from "./m5";
import { type LlmCallRow, unitCost } from "./m7";
import { type GateRow, realLabelEvidence } from "./m8";
import { type ReplyOutcomeRows, replyOutcomeCounts } from "./reply-drafts";
import { weekRange } from "./week";

export interface WeekRows {
  truth: readonly MailTruthRow[];
  delegations: readonly DelegationDueRow[];
  /** Null: the organization has no loops (flag off); the totals are the delegations and `m2` has no split. */
  loops: readonly LoopDueRow[] | null;
  moves: readonly HiddenMoveRow[];
  rejects: readonly RejectRow[];
  mistakes: readonly MistakeRow[];
  handled: readonly HandledRow[];
  urgent: readonly UrgentNoticeRow[];
  llmCalls: readonly LlmCallRow[];
  replies: ReplyOutcomeRows;
  gates: readonly GateRow[];
  mailboxes: number;
}

export function buildWeekStats(
  rows: WeekRows,
  opts: { weekStart: string; mailboxId: string | null; timeZone: string; now: Date }
): WeekStats {
  const range = weekRange(opts.weekStart, opts.timeZone);
  const { byKind, ...m2 } = openLoopsOnTime(
    { delegations: rows.delegations, loops: rows.loops ?? [] },
    { range, timeZone: opts.timeZone, now: opts.now }
  );
  return weekStatsSchema.parse({
    weekStart: opts.weekStart,
    mailboxId: opts.mailboxId,
    m1: missedImportant(rows.truth),
    m2: rows.loops === null ? m2 : { ...m2, byKind },
    m3: seriousMistakes({ moves: rows.moves, rejects: rows.rejects, mistakes: rows.mistakes }, range),
    m4: handledShare(rows.handled),
    m5: urgentLatency(rows.urgent, { timeZone: opts.timeZone }),
    m7: unitCost(rows.llmCalls, { mailboxes: rows.mailboxes }),
    replyDrafts: replyOutcomeCounts(rows.replies),
    m8: realLabelEvidence(rows.gates),
  });
}
