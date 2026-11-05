import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";

import { HardError, SoftError } from "./errors";
import {
  classifyLlmError,
  createLlmClient,
  createRateLimiter,
  type GenerateFn,
  type GenerateResult,
  LlmBlockedError,
  LlmConfigError,
  llmErrorCode,
  LlmHardError,
  LlmOutputError,
  LlmSoftError,
  toGenerateParams,
} from "./llm";
import { setLogLevel } from "./log";

const MODEL = "test-model";
const schema = z.object({ category: z.string(), confidence: z.number() });
const request = { schema, system: "system text", prompt: "prompt MARKER-PROMPT" };

function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; sleeps: number[] } {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

function client(generate: GenerateFn, extra: { timeoutMs?: number; rpm?: number } = {}) {
  const clock = fakeClock();
  return createLlmClient({
    apiKey: "MARKER-KEY",
    classifierModel: MODEL,
    timeoutMs: extra.timeoutMs ?? 1000,
    rpm: extra.rpm ?? 60_000,
    generate,
    now: clock.now,
    sleep: clock.sleep,
  });
}

const answer =
  (result: GenerateResult): GenerateFn =>
  async () =>
    result;
const failWith =
  (error: unknown): GenerateFn =>
  async () => {
    throw error;
  };

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

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

describe("classify output", () => {
  test("good JSON gives data and usage; thinking tokens count as output", async () => {
    const result = await client(
      answer({ text: '{"category":"spam","confidence":0.9}', promptTokens: 100, outputTokens: 20, thoughtsTokens: 5 })
    ).classify(request);
    expect(result.data).toEqual({ category: "spam", confidence: 0.9 });
    expect(result.usage).toEqual({ model: MODEL, tokensIn: 100, tokensOut: 25, latencyMs: 0 });
  });

  test("sends the JSON schema from Zod and uses the request model", async () => {
    let seen: { model: string; jsonSchema: unknown } | undefined;
    const generate: GenerateFn = async (req) => {
      seen = { model: req.model, jsonSchema: req.jsonSchema };
      return { text: '{"category":"a","confidence":1}' };
    };
    const result = await client(generate).classify({ ...request, model: "other-model" });
    expect(seen?.model).toBe("other-model");
    expect(seen?.jsonSchema).toEqual(z.toJSONSchema(schema));
    expect(result.usage.model).toBe("other-model");
  });

  test("a Zod failure is bad_output", async () => {
    const error = await caught(client(answer({ text: '{"category":1}' })).classify(request));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(llmErrorCode(error)).toBe("bad_output");
  });

  test("text that is not JSON is bad_output", async () => {
    const error = await caught(client(answer({ text: "not json" })).classify(request));
    expect(llmErrorCode(error)).toBe("bad_output");
  });

  test.each(["STOP", "MAX_TOKENS"])("empty text with finishReason %s is bad_output", async (finishReason) => {
    const error = await caught(client(answer({ text: undefined, finishReason })).classify(request));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(llmErrorCode(error)).toBe("bad_output");
  });

  test("blockReason SAFETY with no text is llm_blocked (a hard error)", async () => {
    const error = await caught(client(answer({ text: undefined, blockReason: "SAFETY" })).classify(request));
    expect(error).toBeInstanceOf(LlmBlockedError);
    expect(error).toBeInstanceOf(HardError);
    expect(error).not.toBeInstanceOf(SoftError);
    expect(llmErrorCode(error)).toBe("llm_blocked");
  });

  test("finishReason PROHIBITED_CONTENT with no text is llm_blocked", async () => {
    const error = await caught(client(answer({ text: "", finishReason: "PROHIBITED_CONTENT" })).classify(request));
    expect(llmErrorCode(error)).toBe("llm_blocked");
  });
});

describe("classify errors", () => {
  test.each([429, 503])("status %d is a soft error", async (status) => {
    const error = await caught(client(failWith(withStatus(status))).classify(request));
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(error).toBeInstanceOf(SoftError);
    expect(llmErrorCode(error)).toBe(`http_${status}`);
    expect((error as LlmSoftError).model).toBe(MODEL);
  });

  test.each([401, 402, 403, 404])("status %d is a config error", async (status) => {
    const error = await caught(client(failWith({ status })).classify(request));
    expect(error).toBeInstanceOf(LlmConfigError);
    expect(error).toBeInstanceOf(HardError);
    expect(llmErrorCode(error)).toBe(`http_${status}`);
  });

  test("400 with API_KEY_INVALID is http_400_key", async () => {
    const error = await caught(client(failWith(withStatus(400, keyBody))).classify(request));
    expect(error).toBeInstanceOf(LlmConfigError);
    expect(llmErrorCode(error)).toBe("http_400_key");
  });

  test("400 with FAILED_PRECONDITION is http_400_precondition", async () => {
    const body = JSON.stringify({ error: { code: 400, message: "MARKER-BODY", status: "FAILED_PRECONDITION" } });
    const error = await caught(client(failWith(withStatus(400, body))).classify(request));
    expect(error).toBeInstanceOf(LlmConfigError);
    expect(llmErrorCode(error)).toBe("http_400_precondition");
  });

  test("400 with INVALID_ARGUMENT and no details is a plain http_400", async () => {
    const body = JSON.stringify({ error: { code: 400, message: "MARKER-BODY", status: "INVALID_ARGUMENT" } });
    const error = await caught(client(failWith(withStatus(400, body))).classify(request));
    expect(error).toBeInstanceOf(LlmHardError);
    expect(llmErrorCode(error)).toBe("http_400");
  });

  test("400 whose message is not JSON is a plain http_400", async () => {
    const error = await caught(client(failWith(withStatus(400, "not json"))).classify(request));
    expect(error).toBeInstanceOf(LlmHardError);
    expect(llmErrorCode(error)).toBe("http_400");
  });

  test("418 is http_418", async () => {
    const error = await caught(client(failWith({ status: 418 })).classify(request));
    expect(error).toBeInstanceOf(LlmHardError);
    expect(llmErrorCode(error)).toBe("http_418");
  });

  test.each(["TimeoutError", "AbortError"])("an error named %s is timeout", async (name) => {
    const error = await caught(client(failWith(Object.assign(new Error("x"), { name }))).classify(request));
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(llmErrorCode(error)).toBe("timeout");
  });

  test("a generate that never ends gives timeout within 1 s", async () => {
    const started = Date.now();
    const never: GenerateFn = () => new Promise(() => undefined);
    const error = await caught(client(never, { timeoutMs: 50 }).classify(request));
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(llmErrorCode(error)).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("a network failure is unknown", async () => {
    const error = await caught(client(failWith(new TypeError("fetch failed"))).classify(request));
    expect(error).toBeInstanceOf(LlmHardError);
    expect(llmErrorCode(error)).toBe("unknown");
  });

  test("llmErrorCode of a plain error is unknown", () => {
    expect(llmErrorCode(new Error("x"))).toBe("unknown");
  });

  test("classifyLlmError keeps the model", () => {
    const error = classifyLlmError({ status: 500 }, "m1");
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(error.code).toBe("http_500");
    expect(error.model).toBe("m1");
  });

  test("no error message holds the prompt, the key or the error body", async () => {
    const generators: GenerateFn[] = [
      failWith(withStatus(400, keyBody)),
      failWith(withStatus(400, JSON.stringify({ error: { message: "MARKER-BODY" } }))),
      failWith(withStatus(503, "MARKER-BODY")),
      failWith(new TypeError("MARKER-BODY")),
      answer({ text: "MARKER-BODY" }),
      answer({ text: '{"category":"MARKER-BODY"}' }),
      answer({ text: undefined, blockReason: "SAFETY" }),
    ];
    for (const generate of generators) {
      const error = await caught(client(generate).classify(request));
      const message = String((error as Error).message);
      expect(message).toMatch(/^LLM error \S+ \(test-model\)$/);
      for (const marker of ["MARKER-PROMPT", "MARKER-KEY", "MARKER-BODY"]) {
        expect(message).not.toContain(marker);
        expect(String(error)).not.toContain(marker);
      }
    }
  });
});

describe("rate limit and model", () => {
  test("two calls with rpm 60 start 1000 ms apart", async () => {
    const clock = fakeClock();
    const starts: number[] = [];
    const llm = createLlmClient({
      apiKey: "k",
      classifierModel: MODEL,
      timeoutMs: 1000,
      rpm: 60,
      generate: async () => {
        starts.push(clock.now());
        return { text: '{"category":"a","confidence":1}' };
      },
      now: clock.now,
      sleep: clock.sleep,
    });
    await llm.classify(request);
    await llm.classify(request);
    expect(starts).toEqual([0, 1000]);
    expect(clock.sleeps).toEqual([1000]);
  });

  test("the limiter spaces calls that start at the same time", async () => {
    const sleeps: number[] = [];
    const limiter = createRateLimiter({
      rpm: 30,
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect(sleeps).toEqual([2000, 4000]);
  });

  test("classifierModel equals the option", () => {
    expect(client(answer({ text: "{}" })).classifierModel).toBe(MODEL);
  });
});

describe("logs", () => {
  let out: ReturnType<typeof spyOn>;
  let err: ReturnType<typeof spyOn>;

  beforeEach(() => {
    out = spyOn(console, "log").mockImplementation(() => undefined);
    err = spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    out.mockRestore();
    err.mockRestore();
  });

  test("a 503 writes one debug line with the code and no error line", async () => {
    setLogLevel("debug");
    try {
      await caught(client(failWith(withStatus(503, "MARKER-BODY"))).classify(request));
      expect(out).toHaveBeenCalledTimes(1);
      const line = out.mock.calls[0]?.map(String).join(" ") ?? "";
      expect(line.startsWith("[llm]")).toBe(true);
      expect(line).toContain("http_503");
      expect(line).toContain(MODEL);
      expect(line).not.toContain("MARKER");
      expect(err).not.toHaveBeenCalled();
    } finally {
      setLogLevel("info");
    }
  });

  test("a good call writes one debug line with model, latency and tokens", async () => {
    setLogLevel("debug");
    try {
      await client(answer({ text: '{"category":"a","confidence":1}', promptTokens: 7, outputTokens: 3 })).classify(
        request
      );
      expect(out).toHaveBeenCalledTimes(1);
      const line = out.mock.calls[0]?.map(String).join(" ") ?? "";
      expect(line).toContain(MODEL);
      expect(line).toContain("tokensIn=7");
      expect(line).toContain("tokensOut=3");
      expect(line).not.toContain("MARKER");
      expect(err).not.toHaveBeenCalled();
    } finally {
      setLogLevel("info");
    }
  });
});
