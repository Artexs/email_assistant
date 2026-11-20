import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { ConfigError, llmRoleTable, loadConfig } from "./config";

const baseEnv = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
};
const KEY = "ds-KEY-VALUE-MARKER";
const withoutKey = (env: Record<string, string>) => ({ ...env, DEEPSEEK_API_KEY: undefined });
const deepseekEnv = { ...baseEnv, LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: KEY, TRIAGE_LLM_SCOPE: "synthetic" };

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error("did not throw");
}

describe("LLM_PROVIDER=deepseek", () => {
  test("1: loads with a key and the synthetic scope; the row is deepseek-flash on api.deepseek.com", () => {
    const table = llmRoleTable(loadConfig(deepseekEnv));
    expect(table.roles.classifier).toEqual({
      provider: "deepseek",
      model: "deepseek-flash",
      timeoutMs: 30000,
      rpm: null,
      reasoningEffort: "none",
    });
    expect(table.providers.deepseek).toEqual({
      apiKeyName: "DEEPSEEK_API_KEY",
      apiKey: KEY,
      rpm: 60,
      baseUrl: "https://api.deepseek.com",
      endpoint: "standard",
    });
  });

  test("1b: the timeout and the rate come from DEEPSEEK_TIMEOUT_MS and DEEPSEEK_RPM", () => {
    const table = llmRoleTable(loadConfig({ ...deepseekEnv, DEEPSEEK_TIMEOUT_MS: "9000", DEEPSEEK_RPM: "7" }));
    expect(table.roles.classifier.timeoutMs).toBe(9000);
    expect(table.providers.deepseek.rpm).toBe(7);
  });

  test("1c: every role runs on deepseek with its level; an OpenAI key changes nothing on the deepseek row", () => {
    const table = llmRoleTable(loadConfig({ ...deepseekEnv, OPENAI_API_KEY: "sk-openai" }));
    for (const row of Object.values(table.roles)) expect(row.provider).toBe("deepseek");
    expect(table.roles.drafter.reasoningEffort).toBe("low");
    expect(table.roles.classifier.reasoningEffort).toBe("none");
    expect(table.providers.deepseek.apiKey).toBe(KEY);
  });

  test("2: the scope all is refused outside the sim stack; the error names LLM_PROVIDER and no value", () => {
    const error = failure({ ...deepseekEnv, TRIAGE_LLM_SCOPE: "all" });
    expect(error.keys).toEqual(["LLM_PROVIDER"]);
    for (const value of [KEY, baseEnv.DATABASE_URL, baseEnv.CREDENTIALS_KEY])
      expect(error.message).not.toContain(value);
  });

  test("2b: LAB_STACK=ea-sim lets the scope all load; another stack name fails", () => {
    const all = { ...deepseekEnv, TRIAGE_LLM_SCOPE: "all" };
    expect(llmRoleTable(loadConfig({ ...all, LAB_STACK: "ea-sim" })).roles.classifier.provider).toBe("deepseek");
    expect(failure({ ...all, LAB_STACK: "ea-prod" }).keys).toEqual(["LLM_PROVIDER"]);
    expect(failure({ ...all, LAB_STACK: "" }).keys).toEqual(["LLM_PROVIDER"]);
  });

  test("2c: a role key does not pick a provider any more; the removed key is refused and named", () => {
    const env = {
      ...baseEnv,
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "o-key",
      DEEPSEEK_API_KEY: KEY,
      TRIAGE_LLM_SCOPE: "all",
      LLM_DRAFTER_PROVIDER: "deepseek",
    };
    expect(failure(env).keys).toEqual(["LLM_DRAFTER_PROVIDER"]);
    expect(llmRoleTable(loadConfig({ ...env, LLM_DRAFTER_PROVIDER: "" })).roles.drafter.provider).toBe("openai");
  });

  test("2d: openai and gemini load with the scope all outside the sim stack", () => {
    const openai = loadConfig({ ...baseEnv, LLM_PROVIDER: "openai", OPENAI_API_KEY: "o", TRIAGE_LLM_SCOPE: "all" });
    expect(llmRoleTable(openai).roles.classifier.provider).toBe("openai");
    const gemini = loadConfig({ ...baseEnv, LLM_PROVIDER: "gemini", GEMINI_API_KEY: "g", TRIAGE_LLM_SCOPE: "all" });
    expect(llmRoleTable(gemini).roles.classifier.provider).toBe("gemini");
  });

  test("3: no key with a triage scope on fails and names DEEPSEEK_API_KEY", () => {
    expect(failure(withoutKey(deepseekEnv)).keys).toEqual(["DEEPSEEK_API_KEY"]);
    expect(failure({ ...deepseekEnv, DEEPSEEK_API_KEY: "" }).keys).toEqual(["DEEPSEEK_API_KEY"]);
  });

  test("3b: no key with the scope off loads", () => {
    const { DEEPSEEK_API_KEY: _key, ...withoutKey } = deepseekEnv;
    expect(
      llmRoleTable(loadConfig({ ...withoutKey, TRIAGE_LLM_SCOPE: "off" })).providers.deepseek.apiKey
    ).toBeUndefined();
  });

  test("OPENAI_BASE_URL set to the DeepSeek host without the own kind is still refused", () => {
    const error = failure({ ...baseEnv, OPENAI_API_KEY: "o", OPENAI_BASE_URL: "https://api.deepseek.com" });
    expect(error.keys).toEqual(["OPENAI_BASE_URL"]);
  });
});
