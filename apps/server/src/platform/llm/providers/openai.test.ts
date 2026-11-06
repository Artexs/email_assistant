import { buildTriageAnalysisSchema, classifierCategories, reasonCodes } from "@ea/core";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createLlmClient } from "../client";
import { LlmConfigError } from "../errors";

import { toOpenAiResult, toResponseParams, toStrictJsonSchema } from "./openai";

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
    const llm = createLlmClient({
      provider: "gemini",
      apiKey: "k",
      classifierModel: MODEL,
      timeoutMs: 1000,
      rpm: 6000,
      generate: async () => toOpenAiResult(response),
    });
    return llm.classify({ schema: buildTriageAnalysisSchema(classifierCategories), system: "s", prompt: "p" });
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
      fields: { due_date: null, language: "en" },
    });
    await expect(classify({ status: "completed", output_text: text })).rejects.toMatchObject({ code: "bad_output" });
  });
});
