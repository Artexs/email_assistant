import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import type { CliOutput } from "../platform/cli";
import { type Config, loadConfig } from "../platform/config";
import {
  type GenerateFn,
  type GenerateRequest,
  LlmConfigError,
  LlmSoftError,
  type ProviderRegistry,
} from "../platform/llm";

import { runLlmCheck } from "./llm-check";
import { parseLlmCheckArgs } from "./llm-check-args";

// `runLlmCheck` with fake providers: no real call, no key leaves the test.
const base = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  // The client paces calls by provider rate; a high rate keeps the test from waiting.
  OPENAI_RPM: "60000",
  GEMINI_RPM: "60000",
  DEEPSEEK_RPM: "60000",
};

const triageAnswer = {
  category: "needs_reply",
  confidence: 0.95,
  reason_code: "other",
  reason: "Asks a question.",
  summary: null,
  fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
};

function fakeProviders() {
  const requests: { provider: string; model: string }[] = [];
  const make = (provider: string) => ({
    createGenerate: (): GenerateFn => async (req: GenerateRequest) => {
      requests.push({ provider, model: req.model });
      const schema = JSON.stringify(req.jsonSchema);
      const text = schema.includes('"greeting"') ? '{"greeting":"hello"}' : JSON.stringify(triageAnswer);
      return { text, tokensIn: 3, tokensOut: 4, blocked: false };
    },
    classifyError: (_error: unknown, model: string) => new LlmSoftError("network", model),
  });
  const providers: Partial<ProviderRegistry> = {
    openai: make("openai"),
    gemini: make("gemini"),
    deepseek: make("deepseek"),
  };
  return { providers, requests };
}

function capture() {
  const printed: string[] = [];
  const failed: string[] = [];
  const out: CliOutput = { print: (text) => printed.push(text), fail: (text) => failed.push(text) };
  return { out, printed, failed };
}

async function run(config: Config, argv: string[]) {
  const args = parseLlmCheckArgs(argv);
  const fake = fakeProviders();
  const output = capture();
  const code = await runLlmCheck({ config, args, providers: fake.providers, out: output.out });
  return { code, ...output, requests: fake.requests };
}

describe("llm:check", () => {
  test("4: --role all --provider gemini checks five roles on gemini; the judge is the strong tier", async () => {
    const config = loadConfig({ ...base, LLM_PROVIDER: "openai", OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" });
    const result = await run(config, ["--role", "all", "--provider", "gemini"]);
    expect(result.code).toBe(0);
    const greetings = result.printed.filter((line) => line.includes("check=greeting"));
    expect(greetings).toHaveLength(5);
    for (const role of ["classifier", "drafter", "extractor", "judge", "stylist"]) {
      expect(greetings.some((line) => line.startsWith(`role=${role} provider=gemini `))).toBe(true);
    }
    expect(greetings.find((line) => line.startsWith("role=judge"))).toContain("model=gemini-3.8-flash");
    // The classifier also gets its triage call; nothing else does.
    expect(result.printed.filter((line) => line.includes("check=triage"))).toHaveLength(1);
    expect(result.requests.every((request) => request.provider === "gemini")).toBe(true);
    expect(result.printed.join("\n")).not.toMatch(/GEMINI_API_KEY|"g"/);
  });

  test("5: --role all --provider deepseek without its key stops before any call", async () => {
    const config = loadConfig({ ...base, LLM_PROVIDER: "openai", OPENAI_API_KEY: "o" });
    const result = await run(config, ["--role", "all", "--provider", "deepseek"]);
    expect(result.code).toBe(1);
    expect(result.failed).toEqual(["DEEPSEEK_API_KEY is missing"]);
    expect(result.printed).toEqual([]);
    expect(result.requests).toEqual([]);
  });

  test("the default role is the classifier: greeting and triage lines only", async () => {
    const config = loadConfig({ ...base, LLM_PROVIDER: "openai", OPENAI_API_KEY: "o" });
    const result = await run(config, []);
    expect(result.code).toBe(0);
    expect(result.printed.map((line) => /check=(\w+)/.exec(line)?.[1])).toEqual(["greeting", "triage"]);
  });

  test("--provider openai on an own endpoint without OPENAI_OWN_MODEL prints the key name and the usage", async () => {
    const config = loadConfig({
      ...base,
      LLM_PROVIDER: "gemini",
      GEMINI_API_KEY: "g",
      OPENAI_BASE_URL: "http://127.0.0.1:11434/v1",
      OPENAI_ENDPOINT_KIND: "own",
    });
    const result = await run(config, ["--provider", "openai"]);
    expect(result.code).toBe(1);
    expect(result.failed[0]).toBe("OPENAI_OWN_MODEL is missing: an own endpoint needs its model");
    expect(result.failed[1]).toStartWith("usage: bun run llm:check");
    expect(result.requests).toEqual([]);
  });

  test("a failed call gives exit 1 with one failure line", async () => {
    const config = loadConfig({ ...base, LLM_PROVIDER: "openai", OPENAI_API_KEY: "o" });
    const args = parseLlmCheckArgs([]);
    const output = capture();
    const failing: Partial<ProviderRegistry> = {
      openai: {
        createGenerate: (): GenerateFn => async () => {
          throw new Error("boom");
        },
        classifyError: (_error: unknown, model: string) => new LlmConfigError("http_401", model),
      },
    };
    const code = await runLlmCheck({ config, args, providers: failing, out: output.out });
    expect(code).toBe(1);
    expect(output.failed).toEqual(["check failed: LlmConfigError http_401"]);
  });

  test("an unreachable provider (a SoftError) gives exit 3 with one unreachable line and no key", async () => {
    const config = loadConfig({ ...base, LLM_PROVIDER: "openai", OPENAI_API_KEY: "o-secret-key" });
    const args = parseLlmCheckArgs([]);
    const output = capture();
    const down: Partial<ProviderRegistry> = {
      openai: {
        createGenerate: (): GenerateFn => async () => {
          throw new Error("503");
        },
        classifyError: (_error: unknown, model: string) => new LlmSoftError("http_503", model),
      },
    };
    const code = await runLlmCheck({ config, args, providers: down, out: output.out });
    expect(code).toBe(3);
    expect(output.failed).toEqual(["unreachable: LlmSoftError http_503"]);
    expect(output.printed).toEqual([]);
  });
});
