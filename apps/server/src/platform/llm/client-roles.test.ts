import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";

import { setLogLevel } from "../log";

import { createRoleLlmClient, type GenerateFn, type GenerateRequest } from "./client";
import { LlmSoftError, llmErrorCode } from "./errors";
import type { LlmProviderId } from "./providers";
import { type LlmRoleSettings, type LlmRoleTable, uniformRoleTable } from "./settings";

const schema = z.object({ category: z.string(), confidence: z.number() });
const okText = '{"category":"a","confidence":1}';

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

interface Built {
  provider: LlmProviderId;
  apiKey: string;
  reasoningEffort: string | null;
}

// Fake providers: each records how it was built and every request it got.
function fakeProviders(answer: (provider: LlmProviderId, req: GenerateRequest) => Promise<string> | string) {
  const built: Built[] = [];
  const requests: { provider: LlmProviderId; req: GenerateRequest }[] = [];
  const make = (provider: LlmProviderId) => ({
    createGenerate: (o: { apiKey: string; reasoningEffort: string | null }): GenerateFn => {
      built.push({ provider, ...o });
      return async (req) => {
        requests.push({ provider, req });
        return { text: await answer(provider, req), tokensIn: 1, tokensOut: 2, blocked: false };
      };
    },
    classifyError: (_error: unknown, model: string) => new LlmSoftError("network", model),
  });
  return { providers: { gemini: make("gemini"), openai: make("openai") }, built, requests };
}

const classifierRow: LlmRoleSettings = {
  provider: "openai",
  model: "gpt-c",
  timeoutMs: 1000,
  rpm: null,
  reasoningEffort: "none",
};

function twoProviderTable(judge: Partial<LlmRoleSettings> = {}): LlmRoleTable {
  const base = uniformRoleTable(classifierRow, { apiKeyName: "OPENAI_API_KEY", apiKey: "o-key", rpm: 60 });
  return {
    roles: {
      ...base.roles,
      judge: { provider: "gemini", model: "gem-j", timeoutMs: 50, rpm: null, reasoningEffort: null, ...judge },
    },
    providers: {
      openai: { apiKeyName: "OPENAI_API_KEY", apiKey: "o-key", rpm: 60 },
      gemini: { apiKeyName: "GEMINI_API_KEY", apiKey: "g-key", rpm: 30 },
    },
  };
}

const classifierCall = {
  role: "classifier",
  promptVersion: "classifier-v2",
  schema,
  system: "S",
  prompt: "P",
} as const;
const judgeCall = { role: "judge", promptVersion: "judge-v1", schema, system: "S", prompt: "P" } as const;
const drafterCall = { ...classifierCall, role: "drafter", promptVersion: "drafter-v1" } as const;

describe("createRoleLlmClient", () => {
  test("a classifier call builds the request from the role row and returns the usage", async () => {
    const fake = fakeProviders(() => okText);
    const llm = createRoleLlmClient({ table: twoProviderTable(), providers: fake.providers, ...fakeClock() });
    const { data, usage } = await llm.generate(classifierCall);
    expect(data).toEqual({ category: "a", confidence: 1 });
    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0]?.req;
    if (req === undefined) throw new Error("no request");
    expect(req.model).toBe("gpt-c");
    expect(req.system).toBe("S");
    expect(req.prompt).toBe("P");
    expect(req.jsonSchema).toEqual(z.toJSONSchema(schema));
    expect(req.signal).toBeInstanceOf(AbortSignal);
    expect(usage).toEqual({
      role: "classifier",
      promptVersion: "classifier-v2",
      model: "gpt-c",
      tokensIn: 1,
      tokensOut: 2,
      latencyMs: 0,
    });
    expect(fake.built).toEqual([{ provider: "openai", apiKey: "o-key", reasoningEffort: "none" }]);
  });

  test("a second role on another provider uses that provider's generate", async () => {
    const fake = fakeProviders(() => okText);
    const llm = createRoleLlmClient({ table: twoProviderTable(), providers: fake.providers, ...fakeClock() });
    await llm.generate(classifierCall);
    const judge = await llm.generate(judgeCall);
    expect(fake.requests.map((r) => [r.provider, r.req.model])).toEqual([
      ["openai", "gpt-c"],
      ["gemini", "gem-j"],
    ]);
    expect(fake.built).toEqual([
      { provider: "openai", apiKey: "o-key", reasoningEffort: "none" },
      { provider: "gemini", apiKey: "g-key", reasoningEffort: null },
    ]);
    expect(judge.usage.role).toBe("judge");
    expect(llm.modelOf("judge")).toBe("gem-j");
    expect(llm.modelOf("drafter")).toBe("gpt-c");
  });

  test("the provider limiter is shared by the roles of one provider", async () => {
    const clock = fakeClock();
    const starts: [string, number][] = [];
    const fake = fakeProviders((provider) => {
      starts.push([provider, clock.now()]);
      return okText;
    });
    const llm = createRoleLlmClient({ table: twoProviderTable(), providers: fake.providers, ...clock });
    await llm.generate(classifierCall);
    await llm.generate(judgeCall);
    await llm.generate(drafterCall);
    await llm.generate(judgeCall);
    expect(starts).toEqual([
      ["openai", 0],
      ["gemini", 0],
      ["openai", 1000],
      ["gemini", 2000],
    ]);
  });

  test("a role with its own rpm is slower than the provider limit", async () => {
    const clock = fakeClock();
    const starts: number[] = [];
    const fake = fakeProviders(() => {
      starts.push(clock.now());
      return okText;
    });
    const llm = createRoleLlmClient({ table: twoProviderTable({ rpm: 6 }), providers: fake.providers, ...clock });
    await llm.generate(judgeCall);
    await llm.generate(judgeCall);
    expect(starts).toEqual([0, 10_000]);
  });

  test("a role has its own timeout", async () => {
    const fake = fakeProviders((provider) => (provider === "gemini" ? new Promise<string>(() => undefined) : okText));
    const llm = createRoleLlmClient({ table: twoProviderTable(), providers: fake.providers });
    const started = Date.now();
    const error = await llm.generate(judgeCall).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(llmErrorCode(error)).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("one generate is built per provider and effort", async () => {
    const fake = fakeProviders(() => okText);
    const table = twoProviderTable();
    table.roles.drafter = { ...classifierRow, reasoningEffort: "medium" };
    const llm = createRoleLlmClient({ table, providers: fake.providers, ...fakeClock() });
    await llm.generate(classifierCall);
    await llm.generate({ ...classifierCall, role: "extractor", promptVersion: "extractor-v1" });
    await llm.generate(drafterCall);
    expect(fake.built.map((b) => b.reasoningEffort)).toEqual(["none", "medium"]);
  });

  test("a provider without a key gives missing_key and builds nothing", async () => {
    const fake = fakeProviders(() => okText);
    const table = twoProviderTable();
    table.providers.gemini.apiKey = undefined;
    const llm = createRoleLlmClient({ table, providers: fake.providers, ...fakeClock() });
    const error = await llm.generate(judgeCall).catch((e: unknown) => e);
    expect(llmErrorCode(error)).toBe("missing_key");
    expect(fake.built).toEqual([]);
  });

  test("the request model overrides the row model", async () => {
    const fake = fakeProviders(() => okText);
    const llm = createRoleLlmClient({ table: twoProviderTable(), providers: fake.providers, ...fakeClock() });
    const { usage } = await llm.generate({ ...classifierCall, model: "gpt-other" });
    expect(fake.requests[0]?.req.model).toBe("gpt-other");
    expect(usage.model).toBe("gpt-other");
  });

  test("a prompt version of another role, or an unknown role, is a type error", () => {
    const llm = createRoleLlmClient({ table: twoProviderTable(), providers: fakeProviders(() => okText).providers });
    const wrongVersion = () =>
      // @ts-expect-error the version belongs to the judge, not to the classifier
      llm.generate({ ...classifierCall, promptVersion: "judge-v1" });
    const wrongRole = () =>
      // @ts-expect-error "writer" is not a role
      llm.generate({ ...classifierCall, role: "writer" });
    expect(typeof wrongVersion).toBe("function");
    expect(typeof wrongRole).toBe("function");
  });

  test("the debug log holds the role and the model, not the prompt or the key", async () => {
    const lines: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
    setLogLevel("debug");
    try {
      const fake = fakeProviders(() => okText);
      const llm = createRoleLlmClient({ table: twoProviderTable(), providers: fake.providers, ...fakeClock() });
      await llm.generate({ ...judgeCall, prompt: "MARKER-PROMPT" });
      const text = lines.join("\n");
      expect(text).toContain("role=judge");
      expect(text).toContain("model=gem-j");
      expect(text).not.toContain("MARKER");
      expect(text).not.toContain("g-key");
    } finally {
      setLogLevel("info");
      spy.mockRestore();
    }
  });
});
