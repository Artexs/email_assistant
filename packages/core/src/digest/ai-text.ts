import type { CoreTexts } from "../texts";
import type { Category } from "../triage/categories";

export interface AiTextInput {
  category: Category;
  reasonCode: string;
  reason: string | null;
  summary: string | null;
  modelCategory: Category | null;
  confidence: number;
  task?: string | null; // the task of the delegation draft
}

// The AI text of a digest line. The summary and the reason are already marked by `markUntrustedText`; the renderer cuts.
export function aiTextFor(input: AiTextInput, texts: CoreTexts): string | null {
  if (input.reasonCode === "triage_error") return texts.aiText.triageError;
  if (input.reasonCode === "llm_blocked") return texts.aiText.llmBlocked;
  if (input.reasonCode === "blocklist") return texts.aiText.blocklist;
  if (input.category === "unsure" && input.modelCategory !== null) {
    const guess = texts.categories[input.modelCategory];
    return texts.aiText.guess(input.reason ?? texts.aiText.noReason, guess, Math.round(input.confidence * 100));
  }
  if (input.category === "delegation" && input.task) return input.task;
  if (input.category === "info") return input.summary ?? input.reason;
  return input.reason;
}
