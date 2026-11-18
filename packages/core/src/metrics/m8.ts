// M8: evidence for each category on `auto`: the real-label gate row and the Wilson lower bound of its precision.
import { type BarCategory, type GoDecision, wilsonInterval } from "../triage/metrics";
import type { GlobalEvidence } from "../trust/evidence";
import type { HistoryOutcome } from "../trust/history";
import type { TripReason } from "../trust/tripwire";

/** The global holdout evidence of a category on an M8 row (ADR 0028). */
export type M8Global = Pick<GlobalEvidence, "decision" | "provisional" | "wilsonLower" | "cases">;
/** The newest `done` history check of a category on an M8 row. */
export interface M8History {
  outcome: HistoryOutcome;
  acted: number;
  moved: number;
}
/** The tripwire state of a category on an M8 row. */
export interface M8Trip {
  tripped: boolean;
  reason: TripReason | null;
}

/** What the trust reader gives for one mailbox: the three sources of the autonomy evidence, per bar category. */
export interface TrustEvidenceRow {
  global: M8Global;
  history: M8History | null;
  trip: M8Trip;
}
export type TrustEvidenceRows = Record<BarCategory, TrustEvidenceRow>;

export interface GateRow {
  mailboxId: string;
  category: BarCategory;
  auto: boolean;
  kept: number;
  precision: number | null;
  recall: number | null; // of the same real labels (GoNoGoRow.recall)
  decision: GoDecision;
  /** The three sources of ADR 0028 (F110). Absent or null: the flag `trust_ladder` is off, or no reader was given. */
  global?: M8Global | null;
  history?: M8History | null;
  trip?: M8Trip | null;
}

export interface AutoEvidence extends GateRow {
  wilsonLower: number | null;
  global: M8Global | null;
  history: M8History | null;
  trip: M8Trip | null;
}

/** PD-066: the precision of real labels is shown only from 30 labels. */
export const EVIDENCE_MIN_LABELS = 30;

export function realLabelEvidence(rows: readonly GateRow[]): AutoEvidence[] {
  return rows.map((row) => ({
    ...row,
    global: row.global ?? null,
    history: row.history ?? null,
    trip: row.trip ?? null,
    wilsonLower:
      row.precision === null || row.kept === 0
        ? null
        : wilsonInterval(Math.round(row.precision * row.kept), row.kept).lower,
  }));
}
