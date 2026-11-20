// M2: open loops on time, for delegations. A loop is on time when it closes or surfaces by one working day after its due time.
import { DAY_MS } from "../time";
import { type LoopKind, M2_KINDS, type M2Kind } from "../web/stats";

import { addWorkingDays } from "./week";

export const DELEGATION_DEFAULT_DUE_MS = 3 * DAY_MS;

export interface DelegationDueRow {
  id: string;
  sentAt: Date;
  dueAt: Date | null;
  answeredAt: Date | null;
  doneAt: Date | null; // the first delegation.done audit row
  overdueAt: Date | null; // the first delegation.overdue audit row
  cancelled: boolean;
}

export interface OpenLoopsOnTime {
  due: number;
  closedOnTime: number;
  surfacedOnTime: number;
  pending: number;
}

// The user said it is no loop, or withdrew consent: not counted.
const NOT_COUNTED = new Set(["dropped", "untracked", "sent_off"]);
// A close that answers the loop. `stale` and `expired` are the system giving up: due, not closed.
const ANSWERED = new Set(["replied", "replied_subject", "done", "later_reply"]);

export interface LoopDueRow {
  id: string;
  kind: LoopKind;
  /** The current due time (a Later tap moves it). */
  dueAt: Date;
  surfacedAt: Date | null;
  closedAt: Date | null;
  closeReason: string | null;
  /** The first applied follow-up send of the loop. */
  firstFollowUpAt: Date | null;
}

export type OpenLoopsOnTimeByKind = OpenLoopsOnTime & { byKind: Record<M2Kind, OpenLoopsOnTime> };

/** The four totals of a result, without the split. */
export const totalsOf = ({ due, closedOnTime, surfacedOnTime, pending }: OpenLoopsOnTime): OpenLoopsOnTime => ({
  due,
  closedOnTime,
  surfacedOnTime,
  pending,
});

const atOrBefore = (at: Date | null, deadline: Date): boolean => at !== null && at.getTime() <= deadline.getTime();

const empty = (): OpenLoopsOnTime => ({ due: 0, closedOnTime: 0, surfacedOnTime: 0, pending: 0 });

interface Verdict {
  closed: boolean;
  surfaced: boolean;
}

// One row into one tally: out of the range it is skipped; before its deadline and not closed it is pending.
function count(
  tally: OpenLoopsOnTime,
  due: Date,
  deadline: Date,
  verdict: Verdict,
  opts: { range: { start: Date; end: Date }; now: Date }
): void {
  if (due.getTime() < opts.range.start.getTime() || due.getTime() >= opts.range.end.getTime()) return;
  if (deadline.getTime() > opts.now.getTime() && !verdict.closed) {
    tally.pending += 1;
    return;
  }
  tally.due += 1;
  if (verdict.closed) tally.closedOnTime += 1;
  if (verdict.surfaced) tally.surfacedOnTime += 1;
}

export function openLoopsOnTime(
  rows: { delegations: readonly DelegationDueRow[]; loops: readonly LoopDueRow[] },
  opts: { range: { start: Date; end: Date }; timeZone: string; now: Date }
): OpenLoopsOnTimeByKind {
  const byKind: Record<M2Kind, OpenLoopsOnTime> = {
    delegation: empty(),
    waiting: empty(),
    promised: empty(),
    delegated: empty(),
  };
  for (const row of rows.delegations) {
    if (row.cancelled) continue;
    const due = row.dueAt ?? new Date(row.sentAt.getTime() + DELEGATION_DEFAULT_DUE_MS);
    const deadline = addWorkingDays(due, 1, opts.timeZone);
    const closed = atOrBefore(row.answeredAt, deadline) || atOrBefore(row.doneAt, deadline);
    count(byKind.delegation, due, deadline, { closed, surfaced: closed || atOrBefore(row.overdueAt, deadline) }, opts);
  }
  for (const row of rows.loops) {
    if (row.closeReason !== null && NOT_COUNTED.has(row.closeReason)) continue;
    const deadline = addWorkingDays(row.dueAt, 1, opts.timeZone);
    const answered = row.closeReason !== null && ANSWERED.has(row.closeReason) && atOrBefore(row.closedAt, deadline);
    const closed = answered || atOrBefore(row.firstFollowUpAt, deadline);
    count(
      byKind[row.kind],
      row.dueAt,
      deadline,
      { closed, surfaced: closed || atOrBefore(row.surfacedAt, deadline) },
      opts
    );
  }
  const total = empty();
  for (const kind of M2_KINDS) {
    total.due += byKind[kind].due;
    total.closedOnTime += byKind[kind].closedOnTime;
    total.surfacedOnTime += byKind[kind].surfacedOnTime;
    total.pending += byKind[kind].pending;
  }
  return { ...total, byKind };
}
