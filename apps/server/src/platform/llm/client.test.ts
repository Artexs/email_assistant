import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";

import { HardError, SoftError } from "../errors";
import { setLogLevel } from "../log";

import { createRateLimiter, type GenerateFn, type GenerateResult } from "./client";
import { LlmBlockedError, llmErrorCode, LlmOutputError, LlmSoftError } from "./errors";
import { createFixedLlmClient } from "./testing";

const MODEL = "test-model";
const schema = z.object({ category: z.string(), confidence: z.number() });
const request = {
  role: "classifier",
  promptVersion: "classifier-v2",
  schema,
  system: "system text",
  prompt: "prompt MARKER-PROMPT",
} as const;

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
  return createFixedLlmClient(generate, {
    model: MODEL,
    timeoutMs: extra.timeoutMs ?? 1000,
    rpm: extra.rpm ?? 60_000,
    now: clock.now,
    sleep: clock.sleep,
  });
}

const answer =
  (result: Partial<GenerateResult>): GenerateFn =>
  async () => ({ text: undefined, tokensIn: 0, tokensOut: 0, blocked: false, ...result });
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

describe("generate output", () => {
  test("good JSON gives data and usage; thinking tokens count as output", async () => {
    const result = await client(
      answer({ text: '{"category":"spam","confidence":0.9}', tokensIn: 100, tokensOut: 25 })
    ).generate(request);
    expect(result.data).toEqual({ category: "spam", confidence: 0.9 });
    expect(result.usage).toEqual({
      role: "classifier",
      promptVersion: "classifier-v2",
      model: MODEL,
      tokensIn: 100,
      tokensOut: 25,
      latencyMs: 0,
    });
  });

  test("sends the JSON schema from Zod and uses the request model", async () => {
    let seen: { model: string; jsonSchema: unknown } | undefined;
    const generate: GenerateFn = async (req) => {
      seen = { model: req.model, jsonSchema: req.jsonSchema };
      return { text: '{"category":"a","confidence":1}', tokensIn: 0, tokensOut: 0, blocked: false };
    };
    const result = await client(generate).generate({ ...request, model: "other-model" });
    expect(seen?.model).toBe("other-model");
    expect(seen?.jsonSchema).toEqual(z.toJSONSchema(schema));
    expect(result.usage.model).toBe("other-model");
  });

  test("a Zod failure is bad_output", async () => {
    const error = await caught(client(answer({ text: '{"category":1}' })).generate(request));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(llmErrorCode(error)).toBe("bad_output");
  });

  test("text that is not JSON is bad_output", async () => {
    const error = await caught(client(answer({ text: "not json" })).generate(request));
    expect(llmErrorCode(error)).toBe("bad_output");
  });

  test("tokensOut passes through unchanged", async () => {
    const result = await client(
      answer({ text: '{"category":"a","confidence":1}', tokensIn: 3, tokensOut: 11 })
    ).generate(request);
    expect(result.usage.tokensIn).toBe(3);
    expect(result.usage.tokensOut).toBe(11);
  });

  test("empty text that is not blocked is bad_output", async () => {
    const error = await caught(client(answer({ text: undefined, blocked: false })).generate(request));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(llmErrorCode(error)).toBe("bad_output");
  });

  test("blocked with no text is llm_blocked (a hard error)", async () => {
    const error = await caught(client(answer({ text: undefined, blocked: true })).generate(request));
    expect(error).toBeInstanceOf(LlmBlockedError);
    expect(error).toBeInstanceOf(HardError);
    expect(error).not.toBeInstanceOf(SoftError);
    expect(llmErrorCode(error)).toBe("llm_blocked");
  });

  test("blocked with empty text is llm_blocked", async () => {
    const error = await caught(client(answer({ text: "", blocked: true })).generate(request));
    expect(llmErrorCode(error)).toBe("llm_blocked");
  });
});

describe("generate errors", () => {
  test.each([429, 503])("status %d is a soft error", async (status) => {
    const error = await caught(client(failWith(withStatus(status))).generate(request));
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(error).toBeInstanceOf(SoftError);
    expect(llmErrorCode(error)).toBe(`http_${status}`);
    expect((error as LlmSoftError).model).toBe(MODEL);
  });

  test("a generate that never ends gives timeout within 1 s", async () => {
    const started = Date.now();
    const never: GenerateFn = () => new Promise(() => undefined);
    const error = await caught(client(never, { timeoutMs: 50 }).generate(request));
    expect(error).toBeInstanceOf(LlmSoftError);
    expect(llmErrorCode(error)).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("llmErrorCode of a plain error is unknown", () => {
    expect(llmErrorCode(new Error("x"))).toBe("unknown");
  });

  test("no error message holds the prompt, the key or the error body", async () => {
    const generators: GenerateFn[] = [
      failWith(withStatus(400, keyBody)),
      failWith(withStatus(400, JSON.stringify({ error: { message: "MARKER-BODY" } }))),
      failWith(withStatus(503, "MARKER-BODY")),
      failWith(new TypeError("MARKER-BODY")),
      failWith(Object.assign(new TypeError("MARKER-BODY"), { code: "ECONNREFUSED" })),
      answer({ text: "MARKER-BODY" }),
      answer({ text: '{"category":"MARKER-BODY"}' }),
      answer({ text: undefined, blocked: true }),
    ];
    for (const generate of generators) {
      const error = await caught(client(generate).generate(request));
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
    const llm = createFixedLlmClient(
      async () => {
        starts.push(clock.now());
        return { text: '{"category":"a","confidence":1}', tokensIn: 0, tokensOut: 0, blocked: false };
      },
      { model: MODEL, rpm: 60, now: clock.now, sleep: clock.sleep }
    );
    await llm.generate(request);
    await llm.generate(request);
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

  test("modelOf gives the row's model", () => {
    expect(client(answer({ text: "{}" })).modelOf("classifier")).toBe(MODEL);
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
      await caught(client(failWith(withStatus(503, "MARKER-BODY"))).generate(request));
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
      await client(answer({ text: '{"category":"a","confidence":1}', tokensIn: 7, tokensOut: 3 })).generate(request);
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
