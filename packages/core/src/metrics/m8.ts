// M8: evidence for each category on `auto`: the real-label gate row and the Wilson lower bound of its precision.
import { type BarCategory, type GoDecision, wilsonInterval } from "../triage/metrics";

export interface GateRow {
  mailboxId: string;
  category: BarCategory;
  auto: boolean;
  kept: number;
  precision: number | null;
  recall: number | null; // of the same real labels (GoNoGoRow.recall)
  decision: GoDecision;
}

export interface AutoEvidence extends GateRow {
  wilsonLower: number | null;
}

/** PD-066: the precision of real labels is shown only from 30 labels. */
export const EVIDENCE_MIN_LABELS = 30;

export function autoEvidence(rows: readonly GateRow[]): AutoEvidence[] {
  return rows.map((row) => ({
    ...row,
    wilsonLower:
      row.precision === null || row.kept === 0
        ? null
        : wilsonInterval(Math.round(row.precision * row.kept), row.kept).lower,
  }));
}
