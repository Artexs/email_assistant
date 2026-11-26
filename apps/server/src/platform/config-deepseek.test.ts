import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { ConfigError, llmRoleTable, loadConfig } from "./config";
import { checkRealMail } from "./config-llm";

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

  test("2: the scope all loads outside the sim stack; the classifier runs on deepseek", () => {
    const table = llmRoleTable(loadConfig({ ...deepseekEnv, TRIAGE_LLM_SCOPE: "all" }));
    expect(table.roles.classifier.provider).toBe("deepseek");
  });

  test("2b: the scope all loads with the sim stack name, another stack name and an empty one", () => {
    const all = { ...deepseekEnv, TRIAGE_LLM_SCOPE: "all" };
    for (const stack of ["ea-sim", "ea-prod", ""])
      expect(llmRoleTable(loadConfig({ ...all, LAB_STACK: stack })).roles.classifier.provider).toBe("deepseek");
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

  test.each(["https://api.deepseek.com", "https://x.api.deepseek.com"])(
    "OPENAI_BASE_URL set to the DeepSeek host %s is refused with the scope all",
    (url) => {
      const error = failure({
        ...baseEnv,
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "o",
        OPENAI_BASE_URL: url,
        TRIAGE_LLM_SCOPE: "all",
      });
      expect(error.keys).toEqual(["OPENAI_BASE_URL"]);
    }
  );
});

describe("checkRealMail", () => {
  const config = (extra: Record<string, unknown>) => ({ LLM_PROVIDER: "deepseek", ...extra }) as never;
  const issues = (extra: Record<string, unknown>, realMail: boolean) => {
    const found: { path: unknown; message: string }[] = [];
    const ctx = { addIssue: (issue: { path: unknown; message: string }) => found.push(issue) } as never;
    checkRealMail(config(extra), ctx, () => realMail);
    return found;
  };

  test("3: a provider without a row is refused with the scope all outside the sim stack, with no key value", () => {
    const found = issues({ TRIAGE_LLM_SCOPE: "all", DEEPSEEK_API_KEY: KEY }, false);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toEqual(["LLM_PROVIDER"]);
    expect(found[0]?.message).toContain("has no sub-processor row");
    expect(found[0]?.message).not.toContain(KEY);
  });

  test("3b: the sim stack and the synthetic scope pass for a provider without a row", () => {
    expect(issues({ TRIAGE_LLM_SCOPE: "all", LAB_STACK: "ea-sim" }, false)).toEqual([]);
    expect(issues({ TRIAGE_LLM_SCOPE: "synthetic" }, false)).toEqual([]);
  });
});
