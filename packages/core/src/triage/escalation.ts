import type { Category } from "./categories";

// What the trigger reads (F109 D15). The signals come from the first answer and the mail headers.
export interface EscalationSignals {
  // The category after `decideCategory`: `unsure` when the threshold cut it.
  finalCategory: Category;
  // `below_threshold` for a threshold cut; the model's reason code, or a rule code (`triage_error`, `llm_blocked`, `blocklist`).
  reasonCode: string | null;
  noreply: boolean;
  isList: boolean;
  autoSubmitted: string | null;
  precedence: string | null;
}

// A result without a usable model answer. A second opinion cannot fix a missing first answer.
const NO_ESCALATION_REASONS: readonly string[] = ["triage_error", "llm_blocked", "blocklist"];
const HIDING_CATEGORIES: readonly Category[] = ["info", "notification", "spam"];
const BULK_PRECEDENCE: readonly string[] = ["bulk", "list", "junk"];

function isPerson(s: EscalationSignals): boolean {
  if (s.noreply || s.isList) return false;
  const auto = s.autoSubmitted?.trim().toLowerCase() ?? "";
  if (auto !== "" && auto !== "no") return false;
  const precedence = s.precedence?.trim().toLowerCase() ?? "";
  return !BULK_PRECEDENCE.includes(precedence);
}

/**
 * True when a stronger model must classify the mail again: the first answer hides a person's mail (`info`,
 * `notification`, `spam`) or is `unsure`. The mode and the `auto` switch do not matter: shadow results are the
 * evidence of ADR 0028 and must equal what assist would do.
 */
export function shouldEscalate(s: EscalationSignals): boolean {
  if (s.reasonCode !== null && NO_ESCALATION_REASONS.includes(s.reasonCode)) return false;
  if (s.finalCategory === "unsure") return true;
  return HIDING_CATEGORIES.includes(s.finalCategory) && isPerson(s);
}

/** What the first answer leaves in the result row when the second answer wins (stage 14 stores it). */
export function escalationRecord(first: {
  category: Category;
  confidence: number;
  model: string;
  promptVersion: string;
}): {
  fromCategory: Category;
  fromConfidence: number;
  fromModel: string;
  fromPromptVersion: string;
} {
  return {
    fromCategory: first.category,
    fromConfidence: first.confidence,
    fromModel: first.model,
    fromPromptVersion: first.promptVersion,
  };
}
