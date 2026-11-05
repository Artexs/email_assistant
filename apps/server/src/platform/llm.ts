import { type GenerateContentParameters, GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { HardError, SoftError } from "./errors";
import { createLog } from "./log";

const log = createLog("llm");

export interface LlmUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface LlmClient {
  readonly classifierModel: string;
  classify<T>(req: {
    schema: z.ZodType<T>;
    system: string;
    prompt: string;
    model?: string;
  }): Promise<{ data: T; usage: LlmUsage }>;
}

export interface GenerateRequest {
  model: string;
  system: string;
  prompt: string;
  jsonSchema: unknown;
  signal: AbortSignal;
}

export interface GenerateResult {
  text: string | undefined;
  promptTokens?: number;
  outputTokens?: number;
  thoughtsTokens?: number;
  blockReason?: string;
  finishReason?: string;
}

export type GenerateFn = (req: GenerateRequest) => Promise<GenerateResult>;

// Error messages hold only the code and the model: never the prompt, the answer, the error body or the key.
const errorMessage = (code: string, model: string): string => `LLM error ${code} (${model})`;

type SoftCode = "http_429" | "http_500" | "http_502" | "http_503" | "http_504" | "timeout";
type ConfigCode = "http_401" | "http_402" | "http_403" | "http_404" | "http_400_key" | "http_400_precondition";

/** Timeout, 429 or 5xx: the quota or the service, not the mail. */
export class LlmSoftError extends SoftError {
  constructor(
    readonly code: SoftCode,
    readonly model: string
  ) {
    super(errorMessage(code, model));
    this.name = "LlmSoftError";
  }
}

/** A bad key, no payment, no access or an unknown model: retrying the mail does not help. */
export class LlmConfigError extends HardError {
  constructor(
    readonly code: ConfigCode,
    readonly model: string
  ) {
    super(errorMessage(code, model));
    this.name = "LlmConfigError";
  }
}

/** Google blocked the prompt or the answer for safety. */
export class LlmBlockedError extends HardError {
  readonly code = "llm_blocked";

  constructor(readonly model: string) {
    super(errorMessage("llm_blocked", model));
    this.name = "LlmBlockedError";
  }
}

export class LlmHardError extends HardError {
  constructor(
    readonly code: `http_${number}` | "unknown",
    readonly model: string
  ) {
    super(errorMessage(code, model));
    this.name = "LlmHardError";
  }
}

/** Empty text without a block, bad JSON or a Zod failure. */
export class LlmOutputError extends HardError {
  readonly code = "bad_output";

  constructor(readonly model: string) {
    super(errorMessage("bad_output", model));
    this.name = "LlmOutputError";
  }
}

type LlmError = LlmSoftError | LlmConfigError | LlmBlockedError | LlmHardError | LlmOutputError;

function isLlmError(error: unknown): error is LlmError {
  return (
    error instanceof LlmSoftError ||
    error instanceof LlmConfigError ||
    error instanceof LlmBlockedError ||
    error instanceof LlmHardError ||
    error instanceof LlmOutputError
  );
}

export function llmErrorCode(error: unknown): string {
  return isLlmError(error) ? error.code : "unknown";
}

const SOFT_STATUSES = new Set([429, 500, 502, 503, 504]);
const CONFIG_STATUSES = new Set([401, 402, 403, 404]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The SDK puts the JSON error body into `message`. Read here only: never log or store it. */
function code400(message: unknown): "http_400_key" | "http_400_precondition" | "http_400" {
  if (typeof message !== "string") return "http_400";
  let body: unknown;
  try {
    body = JSON.parse(message);
  } catch {
    return "http_400";
  }
  const inner = isRecord(body) ? body.error : undefined;
  if (!isRecord(inner)) return "http_400";
  const details: unknown[] = Array.isArray(inner.details) ? inner.details : [];
  if (details.some((entry) => isRecord(entry) && entry.reason === "API_KEY_INVALID")) return "http_400_key";
  if (inner.status === "FAILED_PRECONDITION") return "http_400_precondition";
  return "http_400";
}

export function classifyLlmError(error: unknown, model: string): LlmSoftError | LlmConfigError | LlmHardError {
  if (!isRecord(error)) return new LlmHardError("unknown", model);
  if (error.name === "AbortError" || error.name === "TimeoutError") return new LlmSoftError("timeout", model);
  const status = error.status;
  if (typeof status !== "number") return new LlmHardError("unknown", model);
  if (SOFT_STATUSES.has(status)) return new LlmSoftError(`http_${status}` as SoftCode, model);
  if (CONFIG_STATUSES.has(status)) return new LlmConfigError(`http_${status}` as ConfigCode, model);
  if (status === 400) {
    const code = code400(error.message);
    return code === "http_400" ? new LlmHardError(code, model) : new LlmConfigError(code, model);
  }
  return new LlmHardError(`http_${status}`, model);
}

export function toGenerateParams(req: GenerateRequest): GenerateContentParameters {
  return {
    model: req.model,
    contents: req.prompt,
    config: {
      systemInstruction: req.system,
      responseMimeType: "application/json",
      responseJsonSchema: req.jsonSchema,
      abortSignal: req.signal,
    },
  };
}

function createGenerate(apiKey: string): GenerateFn {
  const ai = new GoogleGenAI({ apiKey });
  return async (req) => {
    const response = await ai.models.generateContent(toGenerateParams(req));
    return {
      text: response.text,
      promptTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
      thoughtsTokens: response.usageMetadata?.thoughtsTokenCount,
      blockReason: response.promptFeedback?.blockReason,
      finishReason: response.candidates?.[0]?.finishReason,
    };
  };
}

const BLOCK_FINISH_REASONS = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]);

function parseOutput<T>(result: GenerateResult, schema: z.ZodType<T>, model: string): T {
  const text = result.text?.trim() ?? "";
  const blocked =
    result.blockReason !== undefined ||
    (text === "" && result.finishReason !== undefined && BLOCK_FINISH_REASONS.has(result.finishReason));
  if (blocked) throw new LlmBlockedError(model);
  if (text === "") throw new LlmOutputError(model);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LlmOutputError(model);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new LlmOutputError(model);
  return parsed.data;
}

/** Call starts are at least `60000 / rpm` ms apart, in this process. */
export function createRateLimiter(opts: { rpm: number; now: () => number; sleep: (ms: number) => Promise<void> }): {
  acquire(): Promise<void>;
} {
  const gapMs = 60_000 / opts.rpm;
  let nextStart = Number.NEGATIVE_INFINITY;

  return {
    async acquire() {
      const now = opts.now();
      const start = Math.max(now, nextStart);
      nextStart = start + gapMs;
      if (start > now) await opts.sleep(start - now);
    },
  };
}

/** The SDK may not stop on the abort signal: this guard rejects after the same time. */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, model: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LlmSoftError("timeout", model)), timeoutMs);
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    clearTimeout(timer);
  }
}

export function createLlmClient(opts: {
  apiKey: string;
  classifierModel: string;
  timeoutMs: number;
  rpm: number;
  generate?: GenerateFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): LlmClient {
  const generate = opts.generate ?? createGenerate(opts.apiKey);
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const limiter = createRateLimiter({ rpm: opts.rpm, now, sleep });

  return {
    classifierModel: opts.classifierModel,

    async classify(req) {
      const model = req.model ?? opts.classifierModel;
      await limiter.acquire();
      const started = now();
      try {
        const result = await withTimeout(
          generate({
            model,
            system: req.system,
            prompt: req.prompt,
            jsonSchema: z.toJSONSchema(req.schema),
            signal: AbortSignal.timeout(opts.timeoutMs),
          }),
          opts.timeoutMs,
          model
        );
        const data = parseOutput(result, req.schema, model);
        const usage: LlmUsage = {
          model,
          tokensIn: result.promptTokens ?? 0,
          tokensOut: (result.outputTokens ?? 0) + (result.thoughtsTokens ?? 0),
          latencyMs: now() - started,
        };
        log.debug(
          `ok model=${model} latencyMs=${usage.latencyMs} tokensIn=${usage.tokensIn} tokensOut=${usage.tokensOut}`
        );
        return { data, usage };
      } catch (error) {
        const llmError = isLlmError(error) ? error : classifyLlmError(error, model);
        log.debug(`failed model=${model} code=${llmError.code}`);
        throw llmError;
      }
    },
  };
}
