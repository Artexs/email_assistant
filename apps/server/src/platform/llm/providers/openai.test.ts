import { buildTriageAnalysisSchema, classifierCategories, reasonCodes } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import OpenAI from "openai";
import { z } from "zod";

import { setLogLevel } from "../../log";
import { LlmConfigError, LlmHardError, LlmSoftError } from "../errors";
import { createFixedLlmClient } from "../testing";

import {
  classifyOpenAiError,
  createOpenAiGenerate,
  openAiClientOptions,
  type OpenAiLike,
  type OpenAiResponseLike,
  openaiProvider,
  toOpenAiResult,
  toResponseParams,
  toStrictJsonSchema,
} from "./openai";

const MODEL = "test-model";

const triageJsonSchema = (allowed: typeof classifierCategories) =>
  z.toJSONSchema(buildTriageAnalysisSchema(allowed)) as Record<string, unknown>;

const subsets = <T>(items: readonly T[]): T[][] => {
  const result: T[][] = [];
  for (let mask = 1; mask < 2 ** items.length; mask++) result.push(items.filter((_, i) => (mask >> i) & 1));
  return result;
};

function expectStrict(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(expectStrict);
  if (typeof node !== "object" || node === null) return;
  const record = node as Record<string, unknown>;
  if (record.type === "object" || record.properties !== undefined) {
    expect(record.additionalProperties).toBe(false);
    expect(record.required).toEqual(expect.arrayContaining(Object.keys(record.properties as object)));
  }
  Object.values(record).forEach(expectStrict);
}

describe("toStrictJsonSchema", () => {
  test("snapshot of the triage schema", () => {
    expect(toStrictJsonSchema(triageJsonSchema(classifierCategories), MODEL)).toMatchSnapshot();
  });

  test("every allowed-category set gives a strict schema without $schema", () => {
    for (const allowed of subsets(classifierCategories)) {
      const schema = toStrictJsonSchema(triageJsonSchema(allowed), MODEL);
      expect(schema.$schema).toBeUndefined();
      expectStrict(schema);
    }
  });

  test("does not change the input schema", () => {
    const input = triageJsonSchema(classifierCategories);
    const before = JSON.stringify(input);
    toStrictJsonSchema(input, MODEL);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("an optional property throws schema_not_strict and keeps the model", () => {
    const loose = z.toJSONSchema(z.object({ a: z.string(), b: z.string().optional() }));
    try {
      toStrictJsonSchema(loose, MODEL);
      throw new Error("no throw");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmConfigError);
      expect((error as LlmConfigError).code).toBe("schema_not_strict");
      expect((error as LlmConfigError).model).toBe(MODEL);
    }
  });

  test("a nested object without additionalProperties false throws", () => {
    const loose = {
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { type: "object", properties: {} } },
    };
    expect(() => toStrictJsonSchema(loose, MODEL)).toThrow(LlmConfigError);
  });

  test("a loose object inside anyOf throws", () => {
    const loose = {
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { anyOf: [{ type: "null" }, { type: "object", properties: { b: { type: "string" } } }] } },
    };
    expect(() => toStrictJsonSchema(loose, MODEL)).toThrow(LlmConfigError);
  });

  test("a loose object inside items throws", () => {
    const loose = {
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { type: "array", items: { type: "object", properties: { b: { type: "string" } } } } },
    };
    expect(() => toStrictJsonSchema(loose, MODEL)).toThrow(LlmConfigError);
  });

  test("the copy shares no array with the input", () => {
    const input = {
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { type: "string", enum: ["x", "y"] } },
    };
    const copy = toStrictJsonSchema(input, MODEL) as typeof input;
    expect(copy.required).not.toBe(input.required);
    expect(copy.properties.a.enum).not.toBe(input.properties.a.enum);
  });

  test("the same schema gives the same object back", () => {
    const a = toStrictJsonSchema(triageJsonSchema(classifierCategories), MODEL);
    const b = toStrictJsonSchema(triageJsonSchema(classifierCategories), MODEL);
    expect(b).toBe(a);
  });
});

describe("toResponseParams", () => {
  const signal = new AbortController().signal;
  const req = { model: MODEL, system: "s", prompt: "p", jsonSchema: triageJsonSchema(classifierCategories), signal };

  test("sends exactly the planned keys", () => {
    const params = toResponseParams(req, "none");
    expect(Object.keys(params).sort()).toEqual(["input", "instructions", "model", "reasoning", "store", "text"]);
    expect(params.model).toBe(MODEL);
    expect(params.instructions).toBe("s");
    expect(params.input).toBe("p");
    expect(params.store).toBe(false);
    expect(params.reasoning).toEqual({ effort: "none" });
    expect(params.text).toEqual({
      format: { type: "json_schema", name: "result", strict: true, schema: toStrictJsonSchema(req.jsonSchema, MODEL) },
    });
  });

  test("effort null leaves out reasoning", () => {
    expect("reasoning" in toResponseParams(req, null)).toBe(false);
  });
});

describe("toOpenAiResult", () => {
  test("a normal answer gives text and tokens", () => {
    const result = toOpenAiResult({
      status: "completed",
      output_text: "{}",
      output: [{ type: "message", content: [{ type: "output_text" }] }],
      usage: { input_tokens: 607, output_tokens: 50 },
    });
    expect(result).toEqual({ text: "{}", tokensIn: 607, tokensOut: 50, blocked: false });
  });

  test("reasoning tokens do not add to the output", () => {
    const response = {
      status: "completed",
      output_text: "{}",
      usage: { input_tokens: 10, output_tokens: 90, output_tokens_details: { reasoning_tokens: 40 } },
    };
    expect(toOpenAiResult(response).tokensOut).toBe(90);
  });

  test("no usage gives 0 tokens", () => {
    const result = toOpenAiResult({ status: "completed", output_text: "{}" });
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
  });

  test("a refusal item is blocked with no text", () => {
    const result = toOpenAiResult({
      status: "completed",
      output_text: "",
      output: [{ type: "message", content: [{ type: "refusal" }] }],
    });
    expect(result.blocked).toBe(true);
    expect(result.text).toBeUndefined();
  });

  test("incomplete with content_filter is blocked", () => {
    const result = toOpenAiResult({
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
      output_text: "x",
    });
    expect(result.blocked).toBe(true);
    expect(result.text).toBeUndefined();
  });

  test("incomplete with max_output_tokens is not blocked and has no text", () => {
    const result = toOpenAiResult({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: '{"a',
    });
    expect(result.blocked).toBe(false);
    expect(result.text).toBeUndefined();
  });
});

describe("through the shared client", () => {
  const classify = (response: Parameters<typeof toOpenAiResult>[0]) => {
    const llm = createFixedLlmClient(async () => toOpenAiResult(response), { model: MODEL, rpm: 6000 });
    return llm.generate({
      role: "classifier",
      promptVersion: "classifier-v2",
      schema: buildTriageAnalysisSchema(classifierCategories),
      system: "s",
      prompt: "p",
    });
  };

  test("a refusal gives llm_blocked", async () => {
    const promise = classify({ status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] });
    await expect(promise).rejects.toMatchObject({ code: "llm_blocked" });
  });

  test("other incomplete gives bad_output", async () => {
    const promise = classify({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: "{",
    });
    await expect(promise).rejects.toMatchObject({ code: "bad_output" });
  });

  test("a reason of 301 characters gives bad_output", async () => {
    const text = JSON.stringify({
      category: "spam",
      confidence: 0.9,
      reason_code: reasonCodes[0],
      reason: "x".repeat(301),
      summary: null,
      fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
    });
    await expect(classify({ status: "completed", output_text: text })).rejects.toMatchObject({ code: "bad_output" });
  });
});

describe("openAiClientOptions", () => {
  test("turns the SDK retries off", () => {
    expect(openAiClientOptions("k")).toEqual({ apiKey: "k", maxRetries: 0 });
  });
});

const goodResponse: OpenAiResponseLike = {
  status: "completed",
  output_text: "{}",
  usage: { input_tokens: 5, output_tokens: 7 },
};

function fakeClient(create: OpenAiLike["responses"]["create"]): OpenAiLike {
  return { responses: { create } };
}

describe("createOpenAiGenerate", () => {
  const request = (signal: AbortSignal) => ({
    model: MODEL,
    system: "s",
    prompt: "p",
    jsonSchema: triageJsonSchema(classifierCategories),
    signal,
  });

  test("calls the SDK with the planned params and the signal", async () => {
    const calls: { params: unknown; options: unknown }[] = [];
    const client = fakeClient(async (params, options) => {
      calls.push({ params, options });
      return goodResponse;
    });
    const signal = new AbortController().signal;
    const generate = createOpenAiGenerate({ apiKey: "k", reasoningEffort: "none", client });
    const result = await generate(request(signal));
    expect(result).toEqual({ text: "{}", tokensIn: 5, tokensOut: 7, blocked: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual(toResponseParams(request(signal), "none"));
    expect(calls[0]?.options).toEqual({ signal });
    expect(Object.keys(calls[0]?.params as object).sort()).toEqual([
      "input",
      "instructions",
      "model",
      "reasoning",
      "store",
      "text",
    ]);
  });

  test("effort null sends no reasoning key", async () => {
    let seen: Record<string, unknown> = {};
    const client = fakeClient(async (params) => {
      seen = params as unknown as Record<string, unknown>;
      return goodResponse;
    });
    await createOpenAiGenerate({ apiKey: "k", reasoningEffort: null, client })(request(new AbortController().signal));
    expect("reasoning" in seen).toBe(false);
  });

  test("the provider row builds a function with the same shape", () => {
    expect(typeof openaiProvider.createGenerate({ apiKey: "k", reasoningEffort: "none" })).toBe("function");
    expect(openaiProvider.label).toBe("OpenAI");
  });
});

describe("classifyOpenAiError", () => {
  const headers = new Headers();
  const api = (status: number, body: Record<string, unknown>) =>
    OpenAI.APIError.generate(status, body, undefined, headers);
  const soft = (code: string) => expect.objectContaining({ code, model: MODEL, name: "LlmSoftError" });
  const config = (code: string) => expect.objectContaining({ code, model: MODEL, name: "LlmConfigError" });
  const hard = (code: string) => expect.objectContaining({ code, model: MODEL, name: "LlmHardError" });
  const classify = (error: unknown) => classifyOpenAiError(error, MODEL);

  test("429 insufficient_quota is config http_429_quota", () => {
    const quota = api(429, { error: { code: "credit_balance_exhausted", type: "insufficient_quota", message: "m" } });
    expect(quota).toBeInstanceOf(OpenAI.RateLimitError);
    expect(classify(quota)).toEqual(config("http_429_quota"));
  });

  test("429 insufficient_quota as code is config too", () => {
    expect(classify(api(429, { error: { code: "insufficient_quota", message: "m" } }))).toEqual(
      config("http_429_quota")
    );
  });

  test("a plain 429 is soft", () => {
    expect(classify(api(429, { error: { code: "rate_limit_exceeded", type: "requests", message: "m" } }))).toEqual(
      soft("http_429")
    );
  });

  test.each([500, 502, 503, 504])("%d is soft", (status) => {
    expect(classify(api(status, { error: { message: "m" } }))).toEqual(soft(`http_${status}`));
  });

  test("520 is soft http_5xx", () => {
    expect(classify(api(520, { error: { message: "m" } }))).toEqual(soft("http_5xx"));
  });

  test.each([401, 402, 403, 404])("%d is config", (status) => {
    expect(classify(api(status, { error: { message: "m" } }))).toEqual(config(`http_${status}`));
  });

  test("400 invalid_json_schema is config http_400_schema", () => {
    const error = api(400, { error: { code: "invalid_json_schema", type: "invalid_request_error", message: "m" } });
    expect(classify(error)).toEqual(config("http_400_schema"));
  });

  test("other 400 is hard http_400", () => {
    expect(classify(api(400, { error: { code: "invalid_value", message: "m" } }))).toEqual(hard("http_400"));
  });

  test("418 is hard http_418", () => {
    expect(classify(api(418, { error: { message: "m" } }))).toEqual(hard("http_418"));
  });

  test("connection error is soft network", () => {
    expect(classify(new OpenAI.APIConnectionError({ cause: new Error("x") }))).toEqual(soft("network"));
  });

  test("connection timeout is soft timeout", () => {
    expect(classify(new OpenAI.APIConnectionTimeoutError())).toEqual(soft("timeout"));
  });

  test("user abort is soft timeout", () => {
    expect(classify(new OpenAI.APIUserAbortError())).toEqual(soft("timeout"));
  });

  test("AbortError and TimeoutError names are soft timeout", () => {
    expect(classify(Object.assign(new Error("x"), { name: "AbortError" }))).toEqual(soft("timeout"));
    expect(classify(Object.assign(new Error("x"), { name: "TimeoutError" }))).toEqual(soft("timeout"));
  });

  test("a socket code without status is soft network", () => {
    expect(classify(Object.assign(new TypeError("x"), { code: "ECONNREFUSED" }))).toEqual(soft("network"));
  });

  test("a plain Error is hard unknown", () => {
    expect(classify(new Error("x"))).toEqual(hard("unknown"));
  });

  test("a string is hard unknown", () => {
    expect(classify("boom")).toEqual(hard("unknown"));
  });

  test("returns the typed classes", () => {
    expect(classify(api(503, {}))).toBeInstanceOf(LlmSoftError);
    expect(classify(api(401, {}))).toBeInstanceOf(LlmConfigError);
    expect(classify(api(418, {}))).toBeInstanceOf(LlmHardError);
  });
});

describe("OpenAI through the shared client", () => {
  const schema = buildTriageAnalysisSchema(classifierCategories);
  const clientFor = (create: OpenAiLike["responses"]["create"], timeoutMs = 1000) =>
    createFixedLlmClient(
      createOpenAiGenerate({ apiKey: "MARKER-KEY", reasoningEffort: "none", client: fakeClient(create) }),
      { provider: "openai", model: MODEL, timeoutMs, rpm: 6000, reasoningEffort: "none" }
    );
  const input = {
    role: "classifier",
    promptVersion: "classifier-v2",
    schema,
    system: "s",
    prompt: "prompt MARKER-PROMPT",
  } as const;

  test("the 30 s guard: a call that never ends gives timeout", async () => {
    const llm = clientFor(() => new Promise(() => undefined), 50);
    const started = Date.now();
    await expect(llm.generate(input)).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("an SDK error becomes the mapped code", async () => {
    const llm = clientFor(async () => {
      throw OpenAI.APIError.generate(401, { error: { message: "MARKER-BODY" } }, undefined, new Headers());
    });
    await expect(llm.generate(input)).rejects.toMatchObject({ code: "http_401", model: MODEL });
  });

  describe("no leak", () => {
    let out: ReturnType<typeof spyOn>;
    let err: ReturnType<typeof spyOn>;

    beforeEach(() => {
      setLogLevel("debug");
      out = spyOn(console, "log").mockImplementation(() => undefined);
      err = spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      out.mockRestore();
      err.mockRestore();
      setLogLevel("info");
    });

    test("errors, strings and log lines hold no marker", async () => {
      const headers = new Headers();
      const failures = [
        OpenAI.APIError.generate(
          400,
          { error: { message: "MARKER-BODY MARKER-PROMPT MARKER-KEY" } },
          "MARKER-BODY",
          headers
        ),
        OpenAI.APIError.generate(
          429,
          { error: { type: "insufficient_quota", message: "MARKER-BODY" } },
          undefined,
          headers
        ),
        OpenAI.APIError.generate(503, { error: { message: "MARKER-BODY" } }, undefined, headers),
        new OpenAI.APIConnectionError({ message: "MARKER-BODY", cause: new Error("MARKER-BODY") }),
        new TypeError("MARKER-BODY"),
      ];
      for (const failure of failures) {
        const llm = clientFor(async () => {
          throw failure;
        });
        const error = await llm.generate(input).catch((e: unknown) => e);
        const lines = [String((error as Error).message), String(error)];
        for (const call of [...out.mock.calls, ...err.mock.calls]) lines.push(call.map(String).join(" "));
        for (const line of lines) {
          for (const marker of ["MARKER-PROMPT", "MARKER-KEY", "MARKER-BODY"]) expect(line).not.toContain(marker);
        }
      }
    });
  });
});
