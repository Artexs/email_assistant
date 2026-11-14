import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { llmRoleTable, loadConfig } from "../platform/config";

import { JUDGE_SAME_PROVIDER, judgeSetupError } from "./eval-judge-setup";

const base = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "o-key-SECRET-VALUE",
};
const at = new Date("2026-11-14T12:00:00Z");

function tableOf(env: Record<string, string>, judge: { provider?: "openai" | "gemini"; model?: string }) {
  return llmRoleTable(loadConfig({ ...base, ...env }), { judge });
}

describe("judgeSetupError", () => {
  test("the judge on the classifier's provider is refused", () => {
    expect(judgeSetupError(tableOf({}, {}), at)).toBe(JUDGE_SAME_PROVIDER);
    expect(judgeSetupError(tableOf({}, { provider: "openai" }), at)).toBe(
      "judge provider must differ from the classifier provider (PD-026)"
    );
  });

  test("another provider with its key is allowed", () => {
    expect(judgeSetupError(tableOf({ GEMINI_API_KEY: "g-key" }, { provider: "gemini" }), at)).toBeNull();
  });

  test("a missing key of the judge provider is named; no other config value shows", () => {
    const message = judgeSetupError(tableOf({}, { provider: "gemini" }), at);
    expect(message).toBe("GEMINI_API_KEY is missing");
    expect(message).not.toContain("SECRET-VALUE");
    expect(message).not.toContain("postgres");
  });

  test("a judge model with no price is refused", () => {
    const message = judgeSetupError(
      tableOf({ GEMINI_API_KEY: "g-key" }, { provider: "gemini", model: "no-such-model" }),
      at
    );
    expect(message).toContain("no price for model no-such-model");
  });
});
