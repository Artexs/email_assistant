// The evidence lines of the autonomy card. Pure: a `TrustCategory` of the trust view in, fixed phrases out.
// No mail text is used here. The phrases come from the page texts (en and pl), one key per case.
import type { TrustCategory, TrustCheck, TrustView } from "@ea/core/web";

import type { TextKey } from "../i18n";
import { formatPercent } from "./gate-text";

export type TrustBlock = TrustCategory["evidence"]["blocks"][number];

// The categories that have a history check (`movingCategories` of the core): the others have no "Your mail" line.
const MOVING: readonly string[] = ["info", "notification", "spam"];

export type TrustTone = "ok" | "warn" | "muted" | "bad";

export interface TrustLine {
  key: TextKey;
  vars?: Record<string, string | number>;
  tone: TrustTone;
}

// Source 1: the global holdout of the running AI model.
export function proofLine(category: TrustCategory): TrustLine {
  const { global } = category;
  const provisional = global.provisional && global.decision !== "none";
  if (global.decision === "none") return { key: "trust_proof_none", tone: "warn" };
  if (global.decision === "go") {
    const vars = { percent: formatPercent(global.wilsonLower ?? 0), cases: global.cases };
    return provisional
      ? { key: "trust_proof_go_provisional", vars, tone: "warn" }
      : { key: "trust_proof_go", vars, tone: "ok" };
  }
  // `no-go` and `too-few` both read as "not proven": the file did not show the bar.
  if (global.wilsonLower === null) return { key: "trust_proof_no_go_plain", tone: "warn" };
  const vars = { percent: formatPercent(global.wilsonLower) };
  return provisional
    ? { key: "trust_proof_no_go_provisional", vars, tone: "warn" }
    : { key: "trust_proof_no_go", vars, tone: "warn" };
}

// Source 2: the check of the mailbox's last 30 days. `null`: the category has no such check.
export function mailLine(category: string, row: TrustCategory, check: TrustCheck | null): TrustLine | null {
  if (!MOVING.includes(category)) return null;
  const { history } = row;
  if (history === null) {
    return check?.status === "no_result"
      ? { key: "trust_mail_few", tone: "muted" }
      : { key: "trust_mail_unchecked", tone: "muted" };
  }
  const vars = { moved: history.moved, acted: history.acted };
  switch (history.outcome) {
    case "pass":
      return { key: "trust_mail_pass", tone: "ok" };
    case "fail":
      return { key: "trust_mail_fail", vars, tone: "bad" };
    case "inconclusive":
      return { key: "trust_mail_unclear", vars, tone: "muted" };
    case "no_result":
      return { key: "trust_mail_few", tone: "muted" };
  }
}

const PAUSED_KEYS = {
  corrections: "trust_paused_corrections",
  important_hidden: "trust_paused_important_hidden",
  model_switch: "trust_paused_model_switch",
  evidence_changed: "trust_paused_evidence_changed",
  history_fail: "trust_paused_history_fail",
} as const satisfies Record<NonNullable<TrustCategory["trip"]["reason"]>, TextKey>;

// The red line of a tripped category: "Paused: <reason phrase>".
export function pausedLine(row: TrustCategory): TrustLine | null {
  if (!row.trip.tripped) return null;
  return { key: row.trip.reason === null ? "trust_paused_other" : PAUSED_KEYS[row.trip.reason], tone: "bad" };
}

const BLOCK_KEYS = {
  no_global: "trust_block_no_global",
  global_no_go: "trust_block_global_no_go",
  global_provisional: "trust_block_global_provisional",
  history_fail: "trust_block_history_fail",
  tripped: "trust_block_tripped",
  real_labels_no_go: "trust_block_real_labels_no_go",
} as const satisfies Record<TrustBlock, TextKey>;

// One fixed phrase per block of the evidence gate (the text lines of the "Set anyway" dialog).
export function blockLines(blocks: readonly TrustBlock[]): TextKey[] {
  return blocks.map((block) => BLOCK_KEYS[block]);
}

// The blocks the dialog shows: the ones of the 409 body (the answer of the moment), else the ones of the view the card holds.
export function refusalBlocks(
  fromBody: readonly TrustBlock[] | undefined,
  fromView: readonly TrustBlock[]
): readonly TrustBlock[] {
  return fromBody ?? fromView;
}

// The ratings line of today stays, once the user rated enough mails (`kept >= minKept`, as the precision text of the card).
export function showRatingsLine(kept: number, minKept: number): boolean {
  return kept >= minKept;
}

// Every line of one category row, in reading order. `view` null: the flag is off or the view did not load: no evidence lines.
export function trustLines(category: string, view: TrustView | null): TrustLine[] {
  const row = view?.categories[category as keyof TrustView["categories"]];
  if (view === null || row === undefined) return [];
  const lines = [proofLine(row), mailLine(category, row, view.check), pausedLine(row)];
  return lines.filter((line): line is TrustLine => line !== null);
}
