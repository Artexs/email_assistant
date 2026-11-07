import type { Category } from "../triage/categories";

import { categoryLabels } from "./labels";

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
export function aiTextFor(input: AiTextInput): string | null {
  if (input.reasonCode === "triage_error") return "AI triage failed 3 times.";
  if (input.reasonCode === "llm_blocked") return "The AI safety filter blocked this mail.";
  if (input.reasonCode === "blocklist") return "The sender is on your blocklist.";
  if (input.category === "unsure" && input.modelCategory !== null) {
    const guess = categoryLabels[input.modelCategory].name;
    return `${input.reason ?? "No reason given."} (AI guess: ${guess}, ${Math.round(input.confidence * 100)}%)`;
  }
  if (input.category === "delegation" && input.task) return input.task;
  if (input.category === "info") return input.summary ?? input.reason;
  return input.reason;
}
