import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";

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
    expect(aiTextFor({ ...base, reasonCode: "triage_error" }, textTables.en)).toBe("AI triage failed 3 times.");
  });

  test("llm_blocked", () => {
    expect(aiTextFor({ ...base, reasonCode: "llm_blocked" }, textTables.en)).toBe(
      "The AI safety filter blocked this mail."
    );
  });

  test("blocklist", () => {
    expect(aiTextFor({ ...base, reasonCode: "blocklist" }, textTables.en)).toBe("The sender is on your blocklist.");
  });

  test("below the threshold", () => {
    const input = { ...base, category: "unsure" as const, modelCategory: "info" as const, confidence: 0.55 };
    expect(aiTextFor(input, textTables.en)).toBe("Asks a question. (AI guess: Info, 55%)");
    expect(aiTextFor({ ...input, reason: null }, textTables.en)).toBe("No reason given. (AI guess: Info, 55%)");
  });

  test("info uses the summary, else the reason", () => {
    expect(aiTextFor({ ...base, category: "info", summary: "A short summary." }, textTables.en)).toBe(
      "A short summary."
    );
    expect(aiTextFor({ ...base, category: "info", summary: null }, textTables.en)).toBe("Asks a question.");
  });

  test("other categories use the reason", () => {
    expect(aiTextFor(base, textTables.en)).toBe("Asks a question.");
  });
});

describe("aiTextFor a delegation", () => {
  const delegation = { ...base, category: "delegation" as const, reason: "Anna handles offers." };

  test("prefers the task from the draft", () => {
    expect(aiTextFor({ ...delegation, task: "Prepare the offer" }, textTables.en)).toBe("Prepare the offer");
  });

  test("falls back to the reason without a task", () => {
    expect(aiTextFor(delegation, textTables.en)).toBe("Anna handles offers.");
    expect(aiTextFor({ ...delegation, task: null }, textTables.en)).toBe("Anna handles offers.");
  });

  test("the task does not change other categories", () => {
    expect(aiTextFor({ ...base, task: "Prepare the offer" }, textTables.en)).toBe("Asks a question.");
  });
});

describe("aiTextFor in Polish", () => {
  test("triage_error", () => {
    expect(aiTextFor({ ...base, reasonCode: "triage_error" }, textTables.pl)).toBe(
      "Klasyfikacja AI nie powiodła się 3 razy."
    );
  });

  test("below the threshold", () => {
    const input = {
      ...base,
      category: "unsure" as const,
      modelCategory: "info" as const,
      confidence: 0.62,
      reason: "marker",
    };
    expect(aiTextFor(input, textTables.pl)).toBe("marker (AI zgaduje: Info, 62%)");
    expect(aiTextFor({ ...input, reason: null }, textTables.pl)).toBe("Brak uzasadnienia. (AI zgaduje: Info, 62%)");
  });
});
