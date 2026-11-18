import type { CoreTexts } from "../texts";
import type { Category } from "../triage/categories";
import type { SenderRuleKind } from "../triage/rules";

import { cutText } from "./text";

// How sure the system was and which sender rule hit (flag `why_lines`). The builder sets the keys only while the
// flag is on; a view without them renders as before.
export interface WhyInput {
  category: Category;
  // The model confidence, 0 to 1. Null: no model mark (a rule result, an error result, or a view without the key).
  confidence?: number | null | undefined;
  rule?: SenderRuleKind | null | undefined;
}

export const WHY_FIT_TAGS = 3;
export const WHY_FIT_TAG_MAX = 30;
const PERCENT_STEP = 5;

// Results that no model made carry a fixed confidence (1 for a blocked sender, 0 for an error): that is not a mark to show.
const NO_MODEL_REASONS: ReadonlySet<string> = new Set(["blocklist", "triage_error", "llm_blocked"]);

export function hasModelMark(reasonCode: string): boolean {
  return !NO_MODEL_REASONS.has(reasonCode);
}

// The confidence in percent, rounded down to a multiple of 5 (0.999 reads 95: a mark must not promise more than it knows).
// A value outside 0 to 1 is clamped. Plain `Math.floor`: a confidence with up to 3 decimals gives the exact step.
export function confidencePercent(confidence: number): number {
  const steps = Math.floor(Math.min(Math.max(confidence, 0), 1) * (100 / PERCENT_STEP));
  return steps * PERCENT_STEP;
}

// The text after the AI text of an item, or null. A rule replaces the percent. An `unsure` item shows its own guess percent
// in the AI text already, so it gets no second one.
export function whySuffix(input: WhyInput, texts: CoreTexts): string | null {
  if (input.rule !== undefined && input.rule !== null) return texts.why.rule[input.rule];
  if (input.category === "unsure") return null;
  if (input.confidence === undefined || input.confidence === null) return null;
  const percent = confidencePercent(input.confidence);
  return percent > 0 ? `${percent}%` : null;
}

// The `💬` line of an item: the AI text, then ` · <suffix>`. An item with no AI text gets the suffix on a line of its own.
// The AI text is cut before the suffix joins it, so a long text never cuts the mark away.
// Without a suffix the old rules hold byte for byte: the digest skips an empty text; the urgent notice (`printEmpty`) prints `💬 `.
export function aiLine(
  aiText: string | null,
  suffix: string | null,
  maxText: number,
  opts: { printEmpty?: boolean } = {}
): string | null {
  const present = aiText !== null && (aiText !== "" || opts.printEmpty === true);
  const text = present ? cutText(aiText, maxText) : null;
  if (suffix === null) return text === null ? null : `💬 ${text}`;
  return text === null || text === "" ? `💬 ${suffix}` : `💬 ${text} · ${suffix}`;
}

// The competence tags of a delegate as a label, `skills: a, b, c`, or null. At most 3 tags, 30 characters each; a blank tag is left out first.
export function skillsLabel(tags: readonly string[] | null | undefined, texts: CoreTexts): string | null {
  if (tags === undefined || tags === null) return null;
  const shown = tags
    .map((tag) => cutText(tag, WHY_FIT_TAG_MAX))
    .filter((tag) => tag !== "")
    .slice(0, WHY_FIT_TAGS);
  return shown.length === 0 ? null : texts.why.fits(shown.join(", "));
}
