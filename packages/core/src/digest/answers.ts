import type { Category } from "../triage/categories";

import { categoryLabels } from "./labels";

export type UndoAnswerKind = "started" | "already" | "nothing" | "too_old" | "held";

// The texts that Telegram and the web panel show for an undo.
export const UNDO_TEXTS: Record<UndoAnswerKind, string> = {
  started: "↩️ Undo started: the mail goes back within a minute.",
  already: "Undo was already requested for this mail.",
  nothing: "Nothing to undo.",
  too_old: "Too old to undo (7 days).",
  held: "Undo is not possible now: mailbox changes are off or the mailbox is paused.",
};

export function rightAnswer(saved: boolean, category: Category): string {
  return saved ? `✅ Saved: ${categoryLabels[category].name} is right.` : "Already saved.";
}

export function pickAnswer(saved: boolean): string {
  return saved ? "Saved." : "Already saved.";
}

export function pickedText(trueCategory: Category, aiCategory: Category): string {
  return `✏️ Saved: ${categoryLabels[trueCategory].name} (AI said ${categoryLabels[aiCategory].name}).`;
}
