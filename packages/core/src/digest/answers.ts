import type { CoreTexts } from "../texts";
import type { Category } from "../triage/categories";

export const undoAnswerKinds = ["started", "already", "nothing", "too_old", "held"] as const;
export type UndoAnswerKind = (typeof undoAnswerKinds)[number];

// The undo texts that Telegram and the web panel show are in `texts.answers.undo`.

export function rightAnswer(saved: boolean, category: Category, texts: CoreTexts): string {
  return texts.answers.right(saved, texts.categories[category]);
}

export function pickAnswer(saved: boolean, texts: CoreTexts): string {
  return texts.answers.pick(saved);
}

// The picker message after a pick. `saved` is false when the latest feedback row already holds this pick.
export function pickedText(trueCategory: Category, aiCategory: Category, saved: boolean, texts: CoreTexts): string {
  return texts.answers.picked(saved, texts.categories[trueCategory], texts.categories[aiCategory]);
}
