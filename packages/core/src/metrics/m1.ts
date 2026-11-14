// M1: important mail that the assistant missed. A lower bound: only mail with a label or a prediction counts.
import type { Category, FeedbackSource } from "../triage/categories";
import { wilsonInterval } from "../triage/metrics";

export const truthSources = ["correction", "review", "moved_back", "answered_check"] as const;
export type TruthSource = (typeof truthSources)[number];

/** cli, telegram, web, undo → correction; review → review; imap_move → moved_back; answered_check → answered_check. */
export function truthSourceOf(source: FeedbackSource | "answered_check"): TruthSource {
  switch (source) {
    case "review":
      return "review";
    case "imap_move":
      return "moved_back";
    case "answered_check":
      return "answered_check";
    case "cli":
    case "telegram":
    case "web":
    case "undo":
      return "correction";
  }
}

export interface MailTruthRow {
  emailId: string;
  predicted: Category; // the latest triage result
  truth: Category | null; // true_category of the latest feedback row, else null
  truthSource: TruthSource | null; // the source of that row
  wrongOnly: boolean; // the latest feedback says "wrong" without a true category
}

export interface MissedImportant {
  important: number;
  misses: number;
  missesBySource: Record<TruthSource, number>;
  sample: { labelled: number; important: number; misses: number; missRateUpper: number | null };
}

const IMPORTANT: readonly Category[] = ["urgent", "needs_reply"];
const HIDDEN: readonly Category[] = ["info", "notification", "spam"];

export function isImportant(row: MailTruthRow): boolean {
  if (row.truth !== null) return IMPORTANT.includes(row.truth);
  return !row.wrongOnly && IMPORTANT.includes(row.predicted);
}

// An urgent mail without an urgent notice, or a needs-reply mail in the digest's "other mail" part.
export function isMiss(row: MailTruthRow): boolean {
  if (row.truth === "urgent") return row.predicted !== "urgent";
  if (row.truth === "needs_reply") return HIDDEN.includes(row.predicted);
  return false;
}

export function missedImportant(rows: readonly MailTruthRow[]): MissedImportant {
  const missesBySource: Record<TruthSource, number> = { correction: 0, review: 0, moved_back: 0, answered_check: 0 };
  let important = 0;
  let misses = 0;
  let labelled = 0;
  let sampleImportant = 0;
  let sampleMisses = 0;
  for (const row of rows) {
    const rowImportant = isImportant(row);
    const rowMiss = isMiss(row);
    if (rowImportant) important += 1;
    if (rowMiss) {
      misses += 1;
      if (row.truthSource !== null) missesBySource[row.truthSource] += 1;
    }
    if (row.truthSource === "review" && row.truth !== null) {
      labelled += 1;
      if (rowImportant) sampleImportant += 1;
      if (rowMiss) sampleMisses += 1;
    }
  }
  return {
    important,
    misses,
    missesBySource,
    sample: {
      labelled,
      important: sampleImportant,
      misses: sampleMisses,
      missRateUpper: sampleImportant > 0 ? wilsonInterval(sampleMisses, sampleImportant).upper : null,
    },
  };
}
