import { extractorOutputSchema } from "@ea/core";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { createLlmClient } from "../client";
import { LlmConfigError, LlmHardError, LlmSoftError } from "../errors";
import { uniformRoleTable } from "../settings";

import { DEEPSEEK_BASE_URL, createDeepseekGenerate, deepseekProvider, toDeepseekJsonSchema } from "./deepseek";
import type { OpenAiLike, OpenAiResponseLike } from "./openai";

const DEEPSEEK_KEY = "sk-DEEPSEEK-KEY-MARKER";
const schema = z.object({ category: z.string() });

const savedEnv = { ...process.env };
beforeEach(() => {
  // What a shell of the operator may hold: the SDK reads each of them when an option is not set.
  process.env.OPENAI_ORG_ID = "org-x";
  process.env.OPENAI_PROJECT_ID = "p-x";
  process.env.OPENAI_API_KEY = "sk-x";
  process.env.OPENAI_CUSTOM_HEADERS = "x-openai-identity: secret";
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) Reflect.deleteProperty(process.env, key);
  Object.assign(process.env, savedEnv);
});

const goodResponse: OpenAiResponseLike = {
  status: "completed",
  output_text: '{"category":"a"}',
  usage: { input_tokens: 5, output_tokens: 7 },
};

/** A fake client that records the options it was made with and each request. */
function recorder() {
  const made: unknown[] = [];
  const requests: unknown[] = [];
  const newClient = (options: unknown): OpenAiLike => {
    made.push(options);
    return {
      responses: {
        create: async (params) => {
          requests.push(params);
          return goodResponse;
        },
      },
    };
  };
  return { made, requests, newClient };
}

describe("the deepseek adapter", () => {
  test("4: the client gets the DeepSeek key and host, and no OpenAI identity", () => {
    const rec = recorder();
    createDeepseekGenerate({ apiKey: DEEPSEEK_KEY, reasoningEffort: "none", newClient: rec.newClient });
    expect(rec.made).toHaveLength(1);
    expect(rec.made[0]).toMatchObject({
      apiKey: DEEPSEEK_KEY,
      baseURL: "https://api.deepseek.com",
      organization: null,
      project: null,
      adminAPIKey: null,
      webhookSecret: null,
      // The header names of OPENAI_CUSTOM_HEADERS are set to null: the SDK sends none of them.
      defaultHeaders: { "x-openai-identity": null },
    });
    expect(JSON.stringify(rec.made)).not.toContain("sk-x");
  });

  test("4b: the row builds a real SDK client, and the host is fixed whatever base URL the settings carry", () => {
    // `createGenerate` of the row builds the real client; the options are fixed, so the env of the shell changes nothing.
    expect(
      typeof deepseekProvider.createGenerate({
        apiKey: DEEPSEEK_KEY,
        reasoningEffort: "none",
        baseUrl: "https://example.invalid/v1",
        endpoint: "standard",
      })
    ).toBe("function");
    expect(DEEPSEEK_BASE_URL).toBe("https://api.deepseek.com");
  });

  test("5: a classifier call sends effort none and a strict json_schema", async () => {
    const rec = recorder();
    const generate = createDeepseekGenerate({
      apiKey: DEEPSEEK_KEY,
      reasoningEffort: "none",
      newClient: rec.newClient,
    });
    await generate({
      model: "deepseek-flash",
      system: "S",
      prompt: "P",
      jsonSchema: z.toJSONSchema(schema),
      signal: new AbortController().signal,
    });
    expect(rec.requests[0]).toMatchObject({
      model: "deepseek-flash",
      reasoning: { effort: "none" },
      text: { format: { type: "json_schema", strict: true } },
      store: false,
    });
  });

  test("the extractor schema goes out with one flat anyOf per nullable union and no date format", async () => {
    const rec = recorder();
    const generate = createDeepseekGenerate({ apiKey: "k", reasoningEffort: "none", newClient: rec.newClient });
    await generate({
      model: "deepseek-flash",
      system: "S",
      prompt: "P",
      jsonSchema: z.toJSONSchema(extractorOutputSchema),
      signal: new AbortController().signal,
    });
    const sent = rec.requests[0] as { text: { format: { schema: { properties: Record<string, unknown> } } } };
    const due = sent.text.format.schema.properties.due as { anyOf: Record<string, unknown>[] };
    // DeepSeek answers 400 to an `anyOf` branch that is only an `anyOf`, and to `format: date`.
    expect(due.anyOf.map((branch) => Object.keys(branch).sort().join(","))).toEqual([
      "additionalProperties,properties,required,type",
      "additionalProperties,properties,required,type",
      "type",
    ]);
    const date = (due.anyOf[0]?.properties as { date: Record<string, unknown> }).date;
    expect(Object.keys(date).sort()).toEqual(["pattern", "type"]);
  });

  test("an anyOf branch with its own keys stays, a known format stays, and a property may be named format", () => {
    const input = {
      type: "object",
      properties: { format: { type: "string", format: "email" } },
      anyOf: [{ anyOf: [{ type: "string" }], description: "d" }, { type: "null" }],
    };
    expect(toDeepseekJsonSchema(input)).toEqual(input);
  });

  test("the role effort goes out as it is, and a client without effort sends no reasoning field", async () => {
    const rec = recorder();
    const request = {
      model: "deepseek-flash",
      system: "S",
      prompt: "P",
      jsonSchema: z.toJSONSchema(schema),
      signal: new AbortController().signal,
    };
    await createDeepseekGenerate({ apiKey: "k", reasoningEffort: "high", newClient: rec.newClient })(request);
    await createDeepseekGenerate({ apiKey: "k", reasoningEffort: null, newClient: rec.newClient })(request);
    expect(rec.requests[0]).toMatchObject({ reasoning: { effort: "high" } });
    expect(rec.requests[1]).not.toHaveProperty("reasoning");
  });

  test("through the shared client the row classifies a 402 as a config error", async () => {
    const generate = () => Promise.reject(api(402));
    const client = createLlmClient({
      table: uniformRoleTable(
        { provider: "deepseek", model: "deepseek-flash", timeoutMs: 1000, rpm: null, reasoningEffort: "none" },
        {
          apiKeyName: "DEEPSEEK_API_KEY",
          apiKey: DEEPSEEK_KEY,
          rpm: 6000,
          baseUrl: DEEPSEEK_BASE_URL,
          endpoint: "standard",
        }
      ),
      providers: { deepseek: { createGenerate: () => generate, classifyError: deepseekProvider.classifyError } },
    });
    await expect(
      client.generate({ role: "classifier", promptVersion: "classifier-v2", schema, system: "S", prompt: "P" })
    ).rejects.toMatchObject({ name: "LlmConfigError", code: "http_402" });
  });
});

// The classifier reads only `status`, `code` and `type`: a plain error with those fields is what the SDK throws.
const api = (status: number, body: { code?: string } = {}) => Object.assign(new Error("m"), { status, ...body });

describe("classifyError of the deepseek row", () => {
  const classify = (error: unknown) => deepseekProvider.classifyError(error, "deepseek-flash");

  test("6: 402 is a config error, 429 without quota code is soft, 422 is hard", () => {
    const paid = classify(api(402));
    expect(paid).toBeInstanceOf(LlmConfigError);
    expect(paid).toMatchObject({ code: "http_402" });
    const limited = classify(api(429, { code: "rate_limit_exceeded" }));
    expect(limited).toBeInstanceOf(LlmSoftError);
    expect(limited).toMatchObject({ code: "http_429" });
    const invalid = classify(api(422));
    expect(invalid).toBeInstanceOf(LlmHardError);
    expect(invalid).toMatchObject({ code: "http_422" });
  });
});
