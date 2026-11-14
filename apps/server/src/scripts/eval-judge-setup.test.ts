import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { llmRoleTable, loadConfig } from "../platform/config";
import { createLlmClient, type GenerateFn, LlmSoftError } from "../platform/llm";

import { JUDGE_SAME_PROVIDER, judgeSetupError, simRoleTable } from "./eval-judge-setup";

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

// The rate of each provider in the call pool, with fake providers and a fake clock: no real call.
async function callStarts(table: ReturnType<typeof simRoleTable>, roles: ("classifier" | "judge")[]) {
  let t = 0;
  const starts: [string, number][] = [];
  const make = (provider: string) => ({
    createGenerate: (): GenerateFn => async () => {
      starts.push([provider, t]);
      return { text: '{"a":1}', tokensIn: 1, tokensOut: 1, blocked: false };
    },
    classifyError: (_error: unknown, model: string) => new LlmSoftError("network", model),
  });
  const llm = createLlmClient({
    table,
    providers: { gemini: make("gemini"), openai: make("openai") },
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  });
  for (const role of roles) {
    await llm.generate({
      role,
      promptVersion: role === "judge" ? "judge-v1" : "classifier-v2",
      schema: z.object({ a: z.number() }),
      system: "s",
      prompt: "p",
    });
  }
  return starts;
}

describe("simRoleTable: the rates of a judged sim run", () => {
  const judgeTable = (env: Record<string, string> = {}) =>
    tableOf({ GEMINI_API_KEY: "g-key", ...env }, { provider: "gemini" });

  test("--rpm 240 sets the classifier provider only; the judge provider keeps GEMINI_RPM (12)", () => {
    const table = simRoleTable(judgeTable(), { rpm: 240, judge: true });
    expect(table.providers.openai.rpm).toBe(240);
    expect(table.providers.gemini.rpm).toBe(12);
  });

  test("in the call pool the judge calls keep 12 per minute while the classifier calls run at 240", async () => {
    const table = simRoleTable(judgeTable(), { rpm: 240, judge: true });
    const starts = await callStarts(table, ["classifier", "classifier", "judge", "judge", "judge"]);
    expect(starts).toEqual([
      ["openai", 0],
      ["openai", 250],
      ["gemini", 250],
      ["gemini", 5250],
      ["gemini", 10_250],
    ]);
  });

  test("--judge-rpm replaces the judge provider's rate", async () => {
    const table = simRoleTable(judgeTable(), { rpm: 240, judge: true, judgeRpm: 60 });
    expect(table.providers.gemini.rpm).toBe(60);
    expect(table.providers.openai.rpm).toBe(240);
    const starts = await callStarts(table, ["judge", "judge"]);
    expect(starts).toEqual([
      ["gemini", 0],
      ["gemini", 1000],
    ]);
  });

  test("LLM_JUDGE_RPM stays the judge role's rate after --judge-provider; --judge-rpm replaces it", async () => {
    const table = simRoleTable(judgeTable(), { rpm: 240, judge: true, judgeRoleRpm: 6 });
    expect(table.roles.judge.rpm).toBe(6);
    expect(await callStarts(table, ["judge", "judge"])).toEqual([
      ["gemini", 0],
      ["gemini", 10_000],
    ]);
    const override = simRoleTable(judgeTable(), { rpm: 240, judge: true, judgeRoleRpm: 6, judgeRpm: 60 });
    expect(override.roles.judge.rpm).toBeNull();
  });

  test("without --judge only the classifier provider changes", () => {
    const table = simRoleTable(tableOf({ GEMINI_API_KEY: "g-key" }, {}), { rpm: 100, judge: false });
    expect(table.providers.openai.rpm).toBe(100);
    expect(table.providers.gemini.rpm).toBe(12);
  });
});
