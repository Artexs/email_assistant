import { randomBytes } from "node:crypto";

import { llmRoles } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { ConfigError, llmRoleTable, llmSettings, loadConfig } from "./config";

const fullEnv = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
};
const openaiEnv = { ...fullEnv, LLM_PROVIDER: "openai", OPENAI_API_KEY: "o-key" };

function keysOf(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).keys;
  }
  throw new Error("did not throw");
}

describe("llmRoleTable", () => {
  test("1: the classifier row is today's setting", () => {
    const envs = [
      openaiEnv,
      {
        ...openaiEnv,
        OPENAI_REASONING_EFFORT: "low",
        OPENAI_TIMEOUT_MS: "20000",
        OPENAI_RPM: "30",
        OPENAI_MODEL_CLASSIFIER: "m-1",
      },
      { ...fullEnv, LLM_PROVIDER: "gemini", GEMINI_API_KEY: "g-key", GEMINI_MODEL_CLASSIFIER: "g-1", GEMINI_RPM: "7" },
    ];
    for (const env of envs) {
      const config = loadConfig(env);
      const old = llmSettings(config);
      const table = llmRoleTable(config);
      expect(table.roles.classifier).toEqual({
        provider: old.provider,
        model: old.classifierModel,
        timeoutMs: old.timeoutMs,
        rpm: null,
        reasoningEffort: old.reasoningEffort,
      });
      expect(table.providers[old.provider]).toEqual({
        apiKeyName: old.apiKeyName,
        apiKey: old.apiKey,
        rpm: old.rpm,
      });
    }
  });

  test("2: without role keys every role equals the classifier row", () => {
    const table = llmRoleTable(loadConfig(openaiEnv));
    for (const role of llmRoles) expect(table.roles[role]).toEqual(table.roles.classifier);
  });

  test("3: a role on another provider takes that provider's values", () => {
    const table = llmRoleTable(
      loadConfig({ ...openaiEnv, GEMINI_API_KEY: "g-key", LLM_JUDGE_PROVIDER: "gemini", GEMINI_TIMEOUT_MS: "15000" })
    );
    expect(table.roles.judge).toEqual({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      timeoutMs: 15000,
      rpm: null,
      reasoningEffort: null,
    });
    expect(table.roles.drafter.provider).toBe("openai");
  });

  test("4: every role key wins", () => {
    const table = llmRoleTable(
      loadConfig({
        ...openaiEnv,
        LLM_DRAFTER_PROVIDER: "openai",
        LLM_DRAFTER_MODEL: "gpt-x",
        LLM_DRAFTER_TIMEOUT_MS: "60000",
        LLM_DRAFTER_RPM: "10",
        LLM_DRAFTER_REASONING: "medium",
      })
    );
    expect(table.roles.drafter).toEqual({
      provider: "openai",
      model: "gpt-x",
      timeoutMs: 60000,
      rpm: 10,
      reasoningEffort: "medium",
    });
    expect(table.roles.classifier.model).toBe("gpt-6-luna");
  });

  test("5: empty role keys count as not set", () => {
    const table = llmRoleTable(
      loadConfig({ ...openaiEnv, LLM_JUDGE_PROVIDER: "", LLM_JUDGE_MODEL: "", LLM_JUDGE_RPM: "" })
    );
    expect(table.roles.judge).toEqual(table.roles.classifier);
  });

  test("9: overrides", () => {
    const config = loadConfig({
      ...openaiEnv,
      GEMINI_API_KEY: "g-key",
      LLM_JUDGE_PROVIDER: "openai",
      LLM_JUDGE_MODEL: "gpt-judge",
    });
    const table = llmRoleTable(config, {
      classifier: { provider: "gemini", model: "g-2" },
      judge: { provider: "openai" },
    });
    expect(table.roles.classifier).toEqual({
      provider: "gemini",
      model: "g-2",
      timeoutMs: 30000,
      rpm: null,
      reasoningEffort: null,
    });
    expect(table.roles.judge).toEqual({
      provider: "openai",
      model: "gpt-6-luna",
      timeoutMs: 30000,
      rpm: null,
      reasoningEffort: "none",
    });
    expect(table.roles.drafter.provider).toBe("gemini");
    expect(() => llmRoleTable(config, { classifier: { provider: "gemini", reasoningEffort: "low" } })).toThrow(
      ConfigError
    );
  });
});

describe("role keys at start", () => {
  test("6: a role provider needs its API key", () => {
    expect(keysOf({ ...openaiEnv, LLM_JUDGE_PROVIDER: "gemini" })).toEqual(["GEMINI_API_KEY"]);
  });

  test("7: a reasoning key needs a provider with an effort setting", () => {
    expect(
      keysOf({ ...openaiEnv, GEMINI_API_KEY: "g", LLM_JUDGE_PROVIDER: "gemini", LLM_JUDGE_REASONING: "low" })
    ).toEqual(["LLM_JUDGE_REASONING"]);
    expect(keysOf({ ...fullEnv, LLM_PROVIDER: "gemini", GEMINI_API_KEY: "g", LLM_EXTRACTOR_REASONING: "low" })).toEqual(
      ["LLM_EXTRACTOR_REASONING"]
    );
  });

  test("8: bad values name their key", () => {
    expect(keysOf({ ...openaiEnv, LLM_JUDGE_PROVIDER: "vertex" })).toEqual(["LLM_JUDGE_PROVIDER"]);
    expect(keysOf({ ...openaiEnv, LLM_JUDGE_RPM: "0" })).toEqual(["LLM_JUDGE_RPM"]);
    expect(keysOf({ ...openaiEnv, LLM_DRAFTER_TIMEOUT_MS: "x" })).toEqual(["LLM_DRAFTER_TIMEOUT_MS"]);
    expect(keysOf({ ...openaiEnv, LLM_DRAFTER_REASONING: "huge" })).toEqual(["LLM_DRAFTER_REASONING"]);
  });

  test("10: a role model needs its provider", () => {
    expect(keysOf({ ...openaiEnv, LLM_JUDGE_MODEL: "gpt-judge" })).toEqual(["LLM_JUDGE_PROVIDER"]);
  });
});
