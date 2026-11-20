import { randomBytes } from "node:crypto";

import { llmRoles } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { ConfigError, llmRoleTable, loadConfig } from "./config";
import { isRemovedEnvKey, removedEnvKeys } from "./config-llm";
import type { LlmRoleSettings } from "./llm";

const fullEnv = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  TRIAGE_LLM_SCOPE: "synthetic",
};
const openaiEnv = { ...fullEnv, LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" };
const geminiEnv = { ...fullEnv, LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" };
const deepseekEnv = { ...fullEnv, LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "k" };
const ownEnv = { ...openaiEnv, OPENAI_BASE_URL: "http://127.0.0.1:11434/v1", OPENAI_OWN_MODEL: "gemma3:12b" };

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error("did not throw");
}

const row = (
  provider: LlmRoleSettings["provider"],
  model: string,
  reasoningEffort: string | null
): LlmRoleSettings => ({
  provider,
  model,
  timeoutMs: 30000,
  rpm: null,
  reasoningEffort,
});

describe("the role table from tiers", () => {
  test("1: openai gives the light tier to four roles and the strong tier to the judge", () => {
    expect(llmRoleTable(loadConfig(openaiEnv)).roles).toEqual({
      classifier: row("openai", "gpt-6-luna", "none"),
      drafter: row("openai", "gpt-6-luna", "low"),
      extractor: row("openai", "gpt-6-luna", "none"),
      stylist: row("openai", "gpt-6-luna", "low"),
      judge: row("openai", "gpt-6.1-terra", "none"),
    });
  });

  test("2: gemini gives its tiers and no effort", () => {
    expect(llmRoleTable(loadConfig(geminiEnv)).roles).toEqual({
      classifier: row("gemini", "gemini-3.5-flash-lite", null),
      drafter: row("gemini", "gemini-3.5-flash-lite", null),
      extractor: row("gemini", "gemini-3.5-flash-lite", null),
      stylist: row("gemini", "gemini-3.5-flash-lite", null),
      judge: row("gemini", "gemini-3.8-flash", null),
    });
  });

  test("3: deepseek gives its tiers and the role efforts", () => {
    expect(llmRoleTable(loadConfig(deepseekEnv)).roles).toEqual({
      classifier: row("deepseek", "deepseek-flash", "none"),
      drafter: row("deepseek", "deepseek-flash", "low"),
      extractor: row("deepseek", "deepseek-flash", "none"),
      stylist: row("deepseek", "deepseek-flash", "low"),
      judge: row("deepseek", "deepseek-v4-pro", "none"),
    });
  });

  test("4: each removed key with a value fails config, names its key, and the message holds no value", () => {
    expect(removedEnvKeys).toHaveLength(12);
    for (const key of removedEnvKeys) {
      const error = failure({ ...openaiEnv, [key]: "x" });
      expect(error.keys).toContain(key);
      expect(error.message).not.toContain('"x"');
      expect(error.message).not.toMatch(/\bx\b/);
    }
  });

  test("the start log marks a removed key: only the 12 removed keys are removed", () => {
    for (const key of removedEnvKeys) expect(isRemovedEnvKey(key)).toBe(true);
    expect(isRemovedEnvKey("LLM_JUDGE_RPM")).toBe(false);
    expect(isRemovedEnvKey("OPENAI_OWN_MODEL")).toBe(false);
  });

  test("5: an empty removed key loads, also in the e2e style env", () => {
    const empty = Object.fromEntries(removedEnvKeys.map((key) => [key, ""]));
    expect(llmRoleTable(loadConfig({ ...openaiEnv, ...empty })).roles.judge.model).toBe("gpt-6.1-terra");
    expect(() => loadConfig({ ...openaiEnv, OPENAI_MODEL_CLASSIFIER: "", LLM_JUDGE_MODEL: "" })).not.toThrow();
    // A value equal to the new one still fails (one rule).
    expect(failure({ ...openaiEnv, OPENAI_MODEL_CLASSIFIER: "gpt-6-luna" }).keys).toContain("OPENAI_MODEL_CLASSIFIER");
  });

  test("6: an own endpoint gives its one model to every role and no effort; the key is needed", () => {
    const table = llmRoleTable(loadConfig(ownEnv));
    for (const role of llmRoles) expect(table.roles[role]).toEqual(row("openai", "gemma3:12b", null));
    expect(failure({ ...ownEnv, OPENAI_OWN_MODEL: "" }).keys).toEqual(["OPENAI_OWN_MODEL"]);
    // OPENAI_OWN_MODEL is read only when the endpoint is own.
    expect(llmRoleTable(loadConfig({ ...openaiEnv, OPENAI_OWN_MODEL: "gemma3:12b" })).roles.judge.model).toBe(
      "gpt-6.1-terra"
    );
  });

  test("6b: a tool override that moves a role to an own openai endpoint needs OPENAI_OWN_MODEL", () => {
    const config = loadConfig({
      ...geminiEnv,
      OPENAI_API_KEY: "o",
      OPENAI_BASE_URL: "http://127.0.0.1:11434/v1",
    });
    expect(() => llmRoleTable(config, { drafter: { provider: "openai" } })).toThrow(ConfigError);
    try {
      llmRoleTable(config, { drafter: { provider: "openai" } });
    } catch (error) {
      expect((error as ConfigError).keys).toEqual(["OPENAI_OWN_MODEL"]);
    }
    expect(llmRoleTable(config, { drafter: { provider: "openai", model: "m" } }).roles.drafter.model).toBe("m");
  });

  test("7: a role key sets the role's timeout or rate", () => {
    const table = llmRoleTable(loadConfig({ ...openaiEnv, LLM_JUDGE_RPM: "5", LLM_DRAFTER_TIMEOUT_MS: "90000" }));
    expect(table.roles.judge.rpm).toBe(5);
    expect(table.roles.drafter.timeoutMs).toBe(90000);
    expect(table.roles.classifier).toMatchObject({ rpm: null, timeoutMs: 30000 });
    expect(table.roles.extractor).toMatchObject({ rpm: null, timeoutMs: 30000 });
  });

  test("7b: the provider timeout applies to every role; a bad role key names its key", () => {
    const table = llmRoleTable(loadConfig({ ...openaiEnv, OPENAI_TIMEOUT_MS: "20000", LLM_JUDGE_TIMEOUT_MS: "9000" }));
    expect(table.roles.classifier.timeoutMs).toBe(20000);
    expect(table.roles.judge.timeoutMs).toBe(9000);
    expect(failure({ ...openaiEnv, LLM_JUDGE_RPM: "0" }).keys).toEqual(["LLM_JUDGE_RPM"]);
    expect(failure({ ...openaiEnv, LLM_DRAFTER_TIMEOUT_MS: "x" }).keys).toEqual(["LLM_DRAFTER_TIMEOUT_MS"]);
  });

  test("8: an override moves one role to another provider and its tiers; role keys still apply", () => {
    const config = loadConfig({ ...openaiEnv, GEMINI_API_KEY: "g", LLM_DRAFTER_RPM: "4", GEMINI_TIMEOUT_MS: "15000" });
    const table = llmRoleTable(config, { drafter: { provider: "gemini" } });
    expect(table.roles.drafter).toEqual({ ...row("gemini", "gemini-3.5-flash-lite", null), timeoutMs: 15000, rpm: 4 });
    expect(table.roles.classifier.provider).toBe("openai");
    expect(llmRoleTable(config, { judge: { model: "m-1", reasoningEffort: "low" } }).roles.judge).toEqual(
      row("openai", "m-1", "low")
    );
  });

  test("9: an override effort on a provider without effort throws a ConfigError", () => {
    const config = loadConfig(geminiEnv);
    expect(() => llmRoleTable(config, { judge: { reasoningEffort: "low" } })).toThrow(ConfigError);
  });

  test("11: the removed LLM_ESCALATION_* keys in an old .env still do not stop the start and build no role", () => {
    const config = loadConfig({ ...openaiEnv, LLM_ESCALATION_PROVIDER: "openai", LLM_ESCALATION_REASONING: "huge" });
    expect(Object.keys(config).filter((key) => key.startsWith("LLM_ESCALATION_"))).toEqual([]);
    expect(Object.keys(llmRoleTable(config).roles).sort()).toEqual([
      "classifier",
      "drafter",
      "extractor",
      "judge",
      "stylist",
    ]);
  });
});
