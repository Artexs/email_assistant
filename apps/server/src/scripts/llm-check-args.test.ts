import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createLlmClient, type GenerateFn, type GenerateRequest } from "../platform/llm";
import { LlmSoftError } from "../platform/llm/errors";
import type { LlmProviderId } from "../platform/llm/providers";
import { type LlmRoleSettings, type LlmRoleTable, uniformRoleTable } from "../platform/llm/settings";

import { greetingCall, greetingSchema, parseLlmCheckArgs } from "./llm-check-args";

// Fake providers: each records every request it got.
function fakeProviders(answer: string) {
  const requests: { provider: LlmProviderId; req: GenerateRequest }[] = [];
  const make = (provider: LlmProviderId) => ({
    createGenerate: (): GenerateFn => async (req) => {
      requests.push({ provider, req });
      return { text: answer, tokensIn: 1, tokensOut: 2, blocked: false };
    },
    classifyError: (_error: unknown, model: string) => new LlmSoftError("network", model),
  });
  return { providers: { gemini: make("gemini"), openai: make("openai") }, requests };
}

const classifierRow: LlmRoleSettings = {
  provider: "openai",
  model: "gpt-c",
  timeoutMs: 1000,
  rpm: null,
  reasoningEffort: "none",
};

function twoProviderTable(): LlmRoleTable {
  const base = uniformRoleTable(classifierRow, { apiKeyName: "OPENAI_API_KEY", apiKey: "o-key", rpm: 60 });
  return {
    roles: {
      ...base.roles,
      judge: { provider: "gemini", model: "gem-j", timeoutMs: 50, rpm: null, reasoningEffort: null },
    },
    providers: {
      openai: { apiKeyName: "OPENAI_API_KEY", apiKey: "o-key", rpm: 60 },
      gemini: { apiKeyName: "GEMINI_API_KEY", apiKey: "g-key", rpm: 30 },
    },
  };
}

describe("parseLlmCheckArgs", () => {
  test("no arguments check the classifier", () => {
    expect(parseLlmCheckArgs([])).toEqual({ role: "classifier", provider: undefined, delegates: false });
  });

  test("--role and --provider are read", () => {
    expect(parseLlmCheckArgs(["--role", "judge", "--provider", "gemini"])).toEqual({
      role: "judge",
      provider: "gemini",
      delegates: false,
    });
  });

  test("--delegates is read for the classifier", () => {
    expect(parseLlmCheckArgs(["--delegates"])).toEqual({ role: "classifier", provider: undefined, delegates: true });
  });

  test("a bad argument gives null", () => {
    expect(parseLlmCheckArgs(["--role", "writer"])).toBeNull();
    expect(parseLlmCheckArgs(["--provider", "vertex"])).toBeNull();
    expect(parseLlmCheckArgs(["--role", "judge", "--delegates"])).toBeNull();
    expect(parseLlmCheckArgs(["extra"])).toBeNull();
    expect(parseLlmCheckArgs(["--unknown"])).toBeNull();
  });
});

describe("greetingCall", () => {
  test("the judge's schema goes to the judge's provider", async () => {
    const fake = fakeProviders('{"greeting":"hello"}');
    const llm = createLlmClient({ table: twoProviderTable(), providers: fake.providers });
    const { data, usage } = await llm.generate(greetingCall("judge"));
    expect(data).toEqual({ greeting: "hello" });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.provider).toBe("gemini");
    expect(fake.requests[0]?.req.model).toBe("gem-j");
    expect(fake.requests[0]?.req.jsonSchema).toEqual(z.toJSONSchema(greetingSchema));
    expect(usage.role).toBe("judge");
    expect(usage.promptVersion).toBe("judge-v0");
  });
});
