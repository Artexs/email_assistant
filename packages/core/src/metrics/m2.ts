// M2: open loops on time, for delegations. A loop is on time when it closes or surfaces by one working day after its due time.
import { addWorkingDays } from "./week";

export const DELEGATION_DEFAULT_DUE_MS = 3 * 24 * 3_600_000;

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

const atOrBefore = (at: Date | null, deadline: Date): boolean => at !== null && at.getTime() <= deadline.getTime();

export function openLoopsOnTime(
  rows: readonly DelegationDueRow[],
  opts: { range: { start: Date; end: Date }; timeZone: string; now: Date }
): OpenLoopsOnTime {
  const result: OpenLoopsOnTime = { due: 0, closedOnTime: 0, surfacedOnTime: 0, pending: 0 };
  for (const row of rows) {
    if (row.cancelled) continue;
    const due = row.dueAt ?? new Date(row.sentAt.getTime() + DELEGATION_DEFAULT_DUE_MS);
    if (due.getTime() < opts.range.start.getTime() || due.getTime() >= opts.range.end.getTime()) continue;
    const deadline = addWorkingDays(due, 1, opts.timeZone);
    const closed = atOrBefore(row.answeredAt, deadline) || atOrBefore(row.doneAt, deadline);
    const surfaced = closed || atOrBefore(row.overdueAt, deadline);
    if (deadline.getTime() > opts.now.getTime() && !closed) {
      result.pending += 1;
      continue;
    }
    result.due += 1;
    if (closed) result.closedOnTime += 1;
    if (surfaced) result.surfacedOnTime += 1;
  }
  return result;
}
