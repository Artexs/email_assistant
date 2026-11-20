import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { llmRoleTable, loadConfig } from "../../platform/config";
import { createLlmClient, type GenerateFn, LlmSoftError } from "../../platform/llm";

import { JUDGE_SAME_MODEL, judgeSetupError, simRoleTable } from "./eval-judge-setup";

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
  test("1: the default judge on the same provider as the model under test is allowed", () => {
    const table = tableOf({}, {});
    expect(table.roles.classifier).toMatchObject({ provider: "openai", model: "gpt-6-luna" });
    expect(table.roles.judge).toMatchObject({ provider: "openai", model: "gpt-6.1-terra" });
    expect(judgeSetupError(table, at)).toBeNull();
  });

  test("2: the same model at another effort is refused (self-grading)", () => {
    const table = tableOf({}, { model: "gpt-6-luna" });
    expect(table.roles.classifier.reasoningEffort).toBe("none");
    expect(table.roles.judge).toMatchObject({ model: "gpt-6-luna" });
    expect(judgeSetupError(table, at)).toBe(JUDGE_SAME_MODEL);
    expect(JUDGE_SAME_MODEL).toBe("judge model must differ from the model under test (ADR 0037)");
  });

  test("the model rule also holds for the drafter role, and compares the drafter row", () => {
    const config = loadConfig(base);
    const same = llmRoleTable(config, { judge: { provider: "openai", model: "gpt-6-luna" } });
    expect(judgeSetupError(same, at, "drafter")).toBe(JUDGE_SAME_MODEL);
    expect(judgeSetupError(llmRoleTable(config, { judge: {} }), at, "drafter")).toBeNull();
    // The model under test is the drafter's, not the classifier's.
    const other = llmRoleTable(config, { drafter: { model: "gpt-6.1-terra" }, judge: {} });
    expect(judgeSetupError(other, at, "drafter")).toBe(JUDGE_SAME_MODEL);
    expect(judgeSetupError(other, at)).toBeNull();
  });

  test("10: a classifier pinned to the strong tier model is the same model as the judge", () => {
    const config = loadConfig(base);
    expect(judgeSetupError(llmRoleTable(config), at)).toBeNull();
    expect(judgeSetupError(llmRoleTable(config, { classifier: { model: "gpt-6.1-terra" } }), at)).toBe(
      JUDGE_SAME_MODEL
    );
  });

  test("10: an own endpoint has one model, so the judge is the same model", () => {
    const own = tableOf({ OPENAI_BASE_URL: "http://127.0.0.1:11434/v1", OPENAI_OWN_MODEL: "gemma3:12b" }, {});
    expect(judgeSetupError(own, at)).toBe(JUDGE_SAME_MODEL);
  });

  test("4: a judge model with no price on the endpoint is refused", () => {
    const eu = { OPENAI_BASE_URL: "https://eu.api.openai.com/v1" };
    expect(judgeSetupError(tableOf(eu, {}), at)).toBe(
      "no price for model gpt-6.1-terra: add it to llmPrices before a judged sim run"
    );
    expect(judgeSetupError(tableOf({}, { provider: "openai", model: "no-such-model" }), at)).toContain(
      "no price for model no-such-model"
    );
  });

  test("a missing key of the judge provider is named; no other config value shows", () => {
    const message = judgeSetupError(tableOf({}, { provider: "gemini" }), at);
    expect(message).toBe("GEMINI_API_KEY is missing");
    expect(message).not.toContain("SECRET-VALUE");
    expect(message).not.toContain("postgres");
  });

  test("the order of the checks: same model, then key, then price", () => {
    const noKey = loadConfig({ ...base, OPENAI_API_KEY: "" });
    expect(judgeSetupError(llmRoleTable(noKey, { judge: { model: "gpt-6-luna" } }), at)).toBe(JUDGE_SAME_MODEL);
    expect(judgeSetupError(llmRoleTable(noKey, { judge: {} }), at)).toBe("OPENAI_API_KEY is missing");
  });
});

describe("the default judge", () => {
  test("5: with only the OpenAI key the judge is the strong tier at effort none; LLM_JUDGE_RPM keeps the model", () => {
    expect(tableOf({}, {}).roles.judge).toMatchObject({
      provider: "openai",
      model: "gpt-6.1-terra",
      reasoningEffort: "none",
      rpm: null,
    });
    expect(tableOf({ LLM_JUDGE_RPM: "20", LLM_JUDGE_TIMEOUT_MS: "9000" }, {}).roles.judge).toMatchObject({
      model: "gpt-6.1-terra",
      rpm: 20,
      timeoutMs: 9000,
    });
  });

  test("6: a removed judge key stops config", () => {
    for (const key of ["LLM_JUDGE_PROVIDER", "LLM_JUDGE_MODEL", "LLM_JUDGE_REASONING"]) {
      expect(() => loadConfig({ ...base, [key]: "openai" })).toThrow();
    }
  });

  test("7: --judge-provider alone keeps the tier model of that provider", () => {
    expect(tableOf({}, { provider: "openai" }).roles.judge.model).toBe("gpt-6.1-terra");
    expect(tableOf({ GEMINI_API_KEY: "g" }, { provider: "gemini" }).roles.judge.model).toBe("gemini-3.8-flash");
  });

  test("the model of the flag wins over the tier", () => {
    expect(tableOf({}, { model: "gpt-x" }).roles.judge.model).toBe("gpt-x");
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

describe("simRoleTable: the rates of a judged run on one provider", () => {
  const judged = (env: Record<string, string> = {}) => tableOf(env, {});

  test("1: --rpm limits the provider; --judge-rpm limits only the judge role", () => {
    const table = simRoleTable(judged(), { rpm: 60, judge: true, judgeRpm: 8 });
    expect(table.providers.openai.rpm).toBe(60);
    expect(table.roles.judge.rpm).toBe(8);
    expect(table.roles.drafter.rpm).toBeNull();
    expect(table.roles.classifier.rpm).toBeNull();
  });

  test("in the call pool the judge calls keep 8 per minute while the classifier calls run at 60", async () => {
    const table = simRoleTable(judged(), { rpm: 60, judge: true, judgeRpm: 8 });
    const starts = await callStarts(table, ["classifier", "classifier", "judge", "judge", "judge"]);
    expect(starts).toEqual([
      ["openai", 0],
      ["openai", 1000],
      ["openai", 2000],
      ["openai", 8500],
      ["openai", 16_000],
    ]);
  });

  test("2: without --judge-rpm the judge role keeps LLM_JUDGE_RPM, also after a judge override", () => {
    expect(simRoleTable(judged({ LLM_JUDGE_RPM: "6" }), { rpm: 60, judge: true }).roles.judge.rpm).toBe(6);
    expect(simRoleTable(judged(), { rpm: 60, judge: true }).roles.judge.rpm).toBeNull();
    const moved = llmRoleTable(loadConfig({ ...base, LLM_JUDGE_RPM: "20", GEMINI_API_KEY: "g" }), {
      judge: { provider: "gemini" },
    });
    expect(simRoleTable(moved, { rpm: 60, judge: true }).roles.judge.rpm).toBe(20);
    // --judge-rpm wins over the role's rate.
    expect(simRoleTable(judged({ LLM_JUDGE_RPM: "6" }), { rpm: 60, judge: true, judgeRpm: 30 }).roles.judge.rpm).toBe(
      30
    );
  });

  test("3: without --judge a judge rate changes nothing", () => {
    const before = judged({ LLM_JUDGE_RPM: "6" });
    const table = simRoleTable(before, { rpm: 60, judge: false, judgeRpm: 8 });
    expect(table.roles.judge).toEqual(before.roles.judge);
    expect(table.providers.openai.rpm).toBe(60);
  });

  test("a drafter run: --rpm limits the drafter's provider; the other provider keeps its rate", () => {
    const table = simRoleTable(tableOf({ GEMINI_API_KEY: "g-key" }, {}), { rpm: 100, judge: false, role: "drafter" });
    expect(table.providers.openai.rpm).toBe(100);
    expect(table.providers.gemini.rpm).toBe(12);
  });
});
