import { describe, expect, test } from "bun:test";

import { type AiTextInput, aiTextFor } from "./ai-text";

const base: AiTextInput = {
  category: "needs_reply",
  reasonCode: "question",
  reason: "Asks a question.",
  summary: null,
  modelCategory: null,
  confidence: 0.9,
};

describe("aiTextFor", () => {
  test("triage_error", () => {
    expect(aiTextFor({ ...base, reasonCode: "triage_error" })).toBe("AI triage failed 3 times.");
  });

  test("llm_blocked", () => {
    expect(aiTextFor({ ...base, reasonCode: "llm_blocked" })).toBe("The AI safety filter blocked this mail.");
  });

  test("blocklist", () => {
    expect(aiTextFor({ ...base, reasonCode: "blocklist" })).toBe("The sender is on your blocklist.");
  });

  test("below the threshold", () => {
    const input = { ...base, category: "unsure" as const, modelCategory: "info" as const, confidence: 0.55 };
    expect(aiTextFor(input)).toBe("Asks a question. (AI guess: Info, 55%)");
    expect(aiTextFor({ ...input, reason: null })).toBe("No reason given. (AI guess: Info, 55%)");
  });

  test("info uses the summary, else the reason", () => {
    expect(aiTextFor({ ...base, category: "info", summary: "A short summary." })).toBe("A short summary.");
    expect(aiTextFor({ ...base, category: "info", summary: null })).toBe("Asks a question.");
  });

  test("other categories use the reason", () => {
    expect(aiTextFor(base)).toBe("Asks a question.");
  });
});

describe("aiTextFor a delegation", () => {
  const delegation = { ...base, category: "delegation" as const, reason: "Anna handles offers." };

  test("prefers the task from the draft", () => {
    expect(aiTextFor({ ...delegation, task: "Prepare the offer" })).toBe("Prepare the offer");
  });

  test("falls back to the reason without a task", () => {
    expect(aiTextFor(delegation)).toBe("Anna handles offers.");
    expect(aiTextFor({ ...delegation, task: null })).toBe("Anna handles offers.");
  });

  test("the task does not change other categories", () => {
    expect(aiTextFor({ ...base, task: "Prepare the offer" })).toBe("Asks a question.");
  });
});
