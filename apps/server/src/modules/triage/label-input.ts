import type { Category } from "@ea/core";

export type LabelInput =
  | { kind: "right" }
  | { kind: "category"; category: Category }
  | { kind: "wrong" }
  | { kind: "skip" }
  | { kind: "quit" }
  | { kind: "ask_again"; message: string };

// Only these 5 categories are offered. `delegation` waits for S4; `unsure` is not a label.
export const labelChoices = [
  "urgent",
  "needs_reply",
  "info",
  "notification",
  "spam",
] as const satisfies readonly Category[];

const unsureMessage = "unsure is not a label: type a category name or number, w, s or q";
const helpMessage = "type Enter, a category name or number (1-5), w, s or q";

export function parseLabelInput(input: string, predicted: Category): LabelInput {
  const text = input.trim().toLowerCase();
  if (text === "" || text === "w") {
    if (predicted === "unsure") {
      return { kind: "ask_again", message: unsureMessage };
    }
    return text === "" ? { kind: "right" } : { kind: "wrong" };
  }
  if (text === "s") {
    return { kind: "skip" };
  }
  if (text === "q") {
    return { kind: "quit" };
  }
  const byNumber = /^[1-5]$/.test(text) ? labelChoices[Number(text) - 1] : undefined;
  const category = byNumber ?? labelChoices.find((choice) => choice === text);
  if (category !== undefined) {
    return { kind: "category", category };
  }
  return { kind: "ask_again", message: helpMessage };
}
