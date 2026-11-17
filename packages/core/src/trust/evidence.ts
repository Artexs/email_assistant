// Eligibility of a category for `auto` from the three evidence sources (F110 D5).
import { EVIDENCE_MIN_LABELS } from "../metrics/m8";

import type { HistoryOutcome } from "./history";
import { movingCategories } from "./key";
import type { TripState } from "./tripwire";

export interface GlobalEvidence {
  decision: "go" | "no-go" | "too-few" | "none";
  provisional: boolean;
  precision: number | null;
  wilsonLower: number | null;
  threshold: number | null;
  cases: number;
  file: string | null;
}

export const evidenceBlocks = [
  "no_global",
  "global_no_go",
  "global_provisional",
  "history_fail",
  "tripped",
  "real_labels_no_go",
] as const;
export type EvidenceBlock = (typeof evidenceBlocks)[number];

export interface AutoEvidenceInput {
  category: string;
  global: GlobalEvidence;
  /** `null`: no history check ended yet. */
  history: { outcome: HistoryOutcome } | null;
  trip: TripState;
  realLabels: { kept: number; decision: "go" | "no-go" | "too-few" };
}

export interface AutoEvidenceResult {
  eligible: boolean;
  recommended: boolean;
  blocks: EvidenceBlock[];
}

export function autoEvidence(input: AutoEvidenceInput): AutoEvidenceResult {
  const { global, history, trip, realLabels } = input;
  const blocks: EvidenceBlock[] = [];
  if (global.decision === "none") blocks.push("no_global");
  // A holdout with too few cases is no proof: it blocks like a no-go (ADR 0028: eligible = a final global `go`).
  if (global.decision === "no-go" || global.decision === "too-few") blocks.push("global_no_go");
  if (global.provisional) blocks.push("global_provisional");
  if (history?.outcome === "fail") blocks.push("history_fail");
  if (trip.tripped) blocks.push("tripped");
  if (realLabels.kept >= EVIDENCE_MIN_LABELS && realLabels.decision === "no-go") blocks.push("real_labels_no_go");
  // A trip stops "recommended" but not a deliberate manual switch (review 1 N4).
  const eligible = blocks.every((block) => block === "tripped");
  const moving = (movingCategories as readonly string[]).includes(input.category);
  return { eligible, recommended: blocks.length === 0 && moving, blocks };
}
