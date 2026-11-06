import { z } from "zod";

import { createLog } from "../log";

import { isLlmError, LlmBlockedError, LlmOutputError, LlmSoftError } from "./errors";
import { type LlmProviderId, llmProviders } from "./providers";

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

/** The normalized result of every provider. */
export interface GenerateResult {
  text: string | undefined;
  tokensIn: number;
  tokensOut: number;
  blocked: boolean;
}

export type GenerateFn = (req: GenerateRequest) => Promise<GenerateResult>;

function parseOutput<T>(result: GenerateResult, schema: z.ZodType<T>, model: string): T {
  if (result.blocked) throw new LlmBlockedError(model);
  const text = result.text?.trim() ?? "";
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
  provider: LlmProviderId;
  apiKey: string;
  classifierModel: string;
  timeoutMs: number;
  rpm: number;
  reasoningEffort?: string | null;
  generate?: GenerateFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): LlmClient {
  const provider = llmProviders[opts.provider];
  const generate =
    opts.generate ?? provider.createGenerate({ apiKey: opts.apiKey, reasoningEffort: opts.reasoningEffort ?? null });
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
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          latencyMs: now() - started,
        };
        log.debug(
          `ok model=${model} latencyMs=${usage.latencyMs} tokensIn=${usage.tokensIn} tokensOut=${usage.tokensOut}`
        );
        return { data, usage };
      } catch (error) {
        const llmError = isLlmError(error) ? error : provider.classifyError(error, model);
        log.debug(`failed model=${model} code=${llmError.code}`);
        throw llmError;
      }
    },
  };
}
