import { randomBytes } from "node:crypto";

import { llmRoles } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { ConfigError, llmRoleTable, loadConfig } from "./config";

const fullEnv = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
};
const openaiEnv = { ...fullEnv, LLM_PROVIDER: "openai", OPENAI_API_KEY: "o-key" };

function configError(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error("did not throw");
}

describe("OPENAI_BASE_URL and OPENAI_ENDPOINT_KIND", () => {
  test("10: a bad URL stops the start with the key, never the value, also with the LLM off", () => {
    for (const scope of ["off", "synthetic", "all"]) {
      const error = configError({ ...openaiEnv, TRIAGE_LLM_SCOPE: scope, OPENAI_BASE_URL: "http://10.0.0.5/v1" });
      expect(error.keys).toEqual(["OPENAI_BASE_URL"]);
      expect(error.message).not.toContain("10.0.0.5");
    }
    // The key alone, without an API key, also stops.
    expect(configError({ ...fullEnv, OPENAI_BASE_URL: "https://user:pw@llm.example.com/v1" }).keys).toEqual([
      "OPENAI_BASE_URL",
    ]);
  });

  test("10: a hosted third-party API stops the start, and the kind lets an own server through", () => {
    expect(configError({ ...openaiEnv, OPENAI_BASE_URL: "https://openrouter.ai/api/v1" }).keys).toEqual([
      "OPENAI_BASE_URL",
    ]);
    expect(
      loadConfig({
        ...openaiEnv,
        OPENAI_BASE_URL: "https://llm.example.com/v1",
        OPENAI_ENDPOINT_KIND: "own",
        OPENAI_OWN_MODEL: "own-m",
      }).OPENAI_BASE_URL
    ).toBe("https://llm.example.com/v1");
    expect(configError({ ...openaiEnv, OPENAI_ENDPOINT_KIND: "eu" }).keys).toEqual(["OPENAI_ENDPOINT_KIND"]);
    expect(
      configError({ ...openaiEnv, OPENAI_BASE_URL: "https://eu.api.openai.com/v1", OPENAI_ENDPOINT_KIND: "own" }).keys
    ).toEqual(["OPENAI_BASE_URL"]);
  });

  test("10: the DeepSeek host stops the start for every kind and scope: no false 'own' reaches it with real mail", () => {
    for (const kind of [undefined, "own"]) {
      for (const scope of ["off", "synthetic", "all"]) {
        const error = configError({
          ...openaiEnv,
          TRIAGE_LLM_SCOPE: scope,
          OPENAI_BASE_URL: "https://api.deepseek.com",
          OPENAI_ENDPOINT_KIND: kind,
        });
        expect(error.keys).toEqual(["OPENAI_BASE_URL"]);
        expect(error.message).not.toContain("api.deepseek.com");
      }
    }
  });

  test("11: no key gives the standard default on the openai provider row; empty counts as unset", () => {
    for (const env of [openaiEnv, { ...openaiEnv, OPENAI_BASE_URL: "", OPENAI_ENDPOINT_KIND: "" }]) {
      const table = llmRoleTable(loadConfig(env));
      expect(table.providers.openai.baseUrl).toBe("https://api.openai.com/v1");
      expect(table.providers.openai.endpoint).toBe("standard");
      expect(table.providers.gemini).toMatchObject({ baseUrl: null, endpoint: "standard" });
      expect(table.roles.classifier.reasoningEffort).toBe("none");
    }
  });

  test("11: the EU URL gives eu and the tier effort", () => {
    const table = llmRoleTable(loadConfig({ ...openaiEnv, OPENAI_BASE_URL: "https://eu.api.openai.com/v1/" }));
    expect(table.providers.openai).toMatchObject({ baseUrl: "https://eu.api.openai.com/v1", endpoint: "eu" });
    expect(table.roles.classifier.reasoningEffort).toBe("none");
    expect(table.roles.drafter.reasoningEffort).toBe("low");
  });

  test("11: an own URL gives own and no reasoning effort in any openai row", () => {
    const env = {
      ...openaiEnv,
      OPENAI_BASE_URL: "http://127.0.0.1:11434/v1",
      OPENAI_OWN_MODEL: "own-m",
    };
    const table = llmRoleTable(loadConfig(env), { judge: { reasoningEffort: "high" } });
    expect(table.providers.openai).toMatchObject({ baseUrl: "http://127.0.0.1:11434/v1", endpoint: "own" });
    for (const role of llmRoles) {
      expect(table.roles[role].provider).toBe("openai");
      expect(table.roles[role].reasoningEffort).toBeNull();
    }
    const withKind = llmRoleTable(
      loadConfig({
        ...openaiEnv,
        OPENAI_BASE_URL: "https://llm.example.com/v1",
        OPENAI_ENDPOINT_KIND: "own",
        OPENAI_OWN_MODEL: "own-m",
      })
    );
    expect(withKind.providers.openai.endpoint).toBe("own");
    expect(withKind.roles.classifier.reasoningEffort).toBeNull();
  });

  test("11: a Gemini role keeps its effort-free row next to an own openai endpoint", () => {
    const table = llmRoleTable(
      loadConfig({
        ...openaiEnv,
        GEMINI_API_KEY: "g",
        OPENAI_BASE_URL: "http://localhost:11434/v1",
        OPENAI_OWN_MODEL: "m",
      }),
      { judge: { provider: "gemini" } }
    );
    expect(table.roles.judge.provider).toBe("gemini");
    expect(table.providers.gemini.endpoint).toBe("standard");
    expect(table.providers.openai.endpoint).toBe("own");
  });
});
