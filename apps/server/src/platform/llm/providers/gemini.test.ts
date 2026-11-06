import { describe, expect, test } from "bun:test";

import { HardError, SoftError } from "../../errors";
import { LlmConfigError, llmErrorCode, LlmHardError, LlmSoftError } from "../errors";

import { classifyGeminiError, toGeminiResult, toGenerateParams } from "./gemini";

const MODEL = "test-model";

function withStatus(status: number, message = "x"): Error {
  return Object.assign(new Error(message), { status });
}

const keyBody = JSON.stringify({
  error: {
    code: 400,
    message: "MARKER-BODY",
    status: "INVALID_ARGUMENT",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }],
  },
});

describe("toGenerateParams", () => {
  test("sends only the model, the prompt, the system text, the JSON type and schema, and the signal", () => {
    const signal = new AbortController().signal;
    const params = toGenerateParams({ model: MODEL, system: "s", prompt: "p", jsonSchema: { type: "object" }, signal });
    expect(params.model).toBe(MODEL);
    expect(params.contents).toBe("p");
    expect(Object.keys(params.config ?? {}).sort()).toEqual([
      "abortSignal",
      "responseJsonSchema",
      "responseMimeType",
      "systemInstruction",
    ]);
    expect(params.config?.responseMimeType).toBe("application/json");
    expect(params.config?.abortSignal).toBe(signal);
  });
});

describe("toGeminiResult", () => {
  test("thinking tokens add to the output", () => {
    const result = toGeminiResult({
      text: "{}",
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
    });
    expect(result).toEqual({ text: "{}", tokensIn: 100, tokensOut: 25, blocked: false });
  });

  test("no usage gives 0 tokens", () => {
    const result = toGeminiResult({ text: "{}" });
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
  });

  test("blockReason SAFETY with no text is blocked", () => {
    expect(toGeminiResult({ promptFeedback: { blockReason: "SAFETY" } }).blocked).toBe(true);
  });

  test("finishReason PROHIBITED_CONTENT with no text is blocked", () => {
    expect(toGeminiResult({ text: "", candidates: [{ finishReason: "PROHIBITED_CONTENT" }] }).blocked).toBe(true);
  });

  test("finishReason SAFETY with text is not blocked", () => {
    expect(toGeminiResult({ text: "{}", candidates: [{ finishReason: "SAFETY" }] }).blocked).toBe(false);
  });

  test.each(["STOP", "MAX_TOKENS"])("empty text with finishReason %s is not blocked", (finishReason) => {
    expect(toGeminiResult({ text: undefined, candidates: [{ finishReason }] }).blocked).toBe(false);
  });
});

describe("classifyGeminiError", () => {
  test.each([429, 503])("status %d is a soft error", (status) => {
    const error = classifyGeminiError(withStatus(status), MODEL);
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(error).toBeInstanceOf(SoftError);
    expect(llmErrorCode(error)).toBe(`http_${status}`);
    expect(error.model).toBe(MODEL);
  });

  test.each([401, 402, 403, 404])("status %d is a config error", (status) => {
    const error = classifyGeminiError({ status }, MODEL);
    expect(error).toBeInstanceOf(LlmConfigError);
    expect(error).toBeInstanceOf(HardError);
    expect(llmErrorCode(error)).toBe(`http_${status}`);
  });

  test("400 with API_KEY_INVALID is http_400_key", () => {
    const error = classifyGeminiError(withStatus(400, keyBody), MODEL);
    expect(error).toBeInstanceOf(LlmConfigError);
    expect(llmErrorCode(error)).toBe("http_400_key");
  });

  test("400 with FAILED_PRECONDITION is http_400_precondition", () => {
    const body = JSON.stringify({ error: { code: 400, message: "MARKER-BODY", status: "FAILED_PRECONDITION" } });
    const error = classifyGeminiError(withStatus(400, body), MODEL);
    expect(error).toBeInstanceOf(LlmConfigError);
    expect(llmErrorCode(error)).toBe("http_400_precondition");
  });

  test("400 with INVALID_ARGUMENT and no details is a plain http_400", () => {
    const body = JSON.stringify({ error: { code: 400, message: "MARKER-BODY", status: "INVALID_ARGUMENT" } });
    const error = classifyGeminiError(withStatus(400, body), MODEL);
    expect(error).toBeInstanceOf(LlmHardError);
    expect(llmErrorCode(error)).toBe("http_400");
  });

  test("400 whose message is not JSON is a plain http_400", () => {
    const error = classifyGeminiError(withStatus(400, "not json"), MODEL);
    expect(error).toBeInstanceOf(LlmHardError);
    expect(llmErrorCode(error)).toBe("http_400");
  });

  test("418 is http_418", () => {
    const error = classifyGeminiError({ status: 418 }, MODEL);
    expect(error).toBeInstanceOf(LlmHardError);
    expect(llmErrorCode(error)).toBe("http_418");
  });

  test.each(["TimeoutError", "AbortError"])("an error named %s is timeout", (name) => {
    const error = classifyGeminiError(Object.assign(new Error("x"), { name }), MODEL);
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(llmErrorCode(error)).toBe("timeout");
  });

  test.each(["ECONNREFUSED", "ENOTFOUND", "ConnectionClosed"])("a TypeError with code %s is network", (code) => {
    const error = classifyGeminiError(Object.assign(new TypeError("fetch failed"), { code }), MODEL);
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(llmErrorCode(error)).toBe("network");
  });

  test("a network code on the cause is network", () => {
    const cause = Object.assign(new Error("connect"), { code: "ECONNRESET" });
    const error = classifyGeminiError(new TypeError("fetch failed", { cause }), MODEL);
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(llmErrorCode(error)).toBe("network");
  });

  test("an error without a network code is unknown", () => {
    for (const failure of [new TypeError("fetch failed"), Object.assign(new Error("x"), { code: "ERR_OTHER" })]) {
      const error = classifyGeminiError(failure, MODEL);
      expect(error).toBeInstanceOf(LlmHardError);
      expect(llmErrorCode(error)).toBe("unknown");
    }
  });

  test("a value that is not an object is unknown", () => {
    expect(llmErrorCode(classifyGeminiError("x", MODEL))).toBe("unknown");
  });

  test("keeps the model", () => {
    const error = classifyGeminiError({ status: 500 }, "m1");
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(error.code).toBe("http_500");
    expect(error.model).toBe("m1");
  });
});
