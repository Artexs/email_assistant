import type { LlmRole, PromptVersion } from "@ea/core";
import { z } from "zod";

import { createLog } from "../log";

import { isLlmError, LlmBlockedError, LlmConfigError, LlmOutputError, LlmSoftError } from "./errors";
import { type LlmProvider, type LlmProviderId, llmProviders } from "./providers";
import type { LlmRoleSettings, LlmRoleTable } from "./settings";

const log = createLog("llm");

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

/** The usage of one call: it goes into the `llm.call` audit row and `triage_results`. */
export interface LlmUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  role: LlmRole;
  promptVersion: string;
}

export interface LlmCall<T, R extends LlmRole> {
  role: R;
  /** The prompt registry version that built `system` and `prompt`. */
  promptVersion: PromptVersion<NoInfer<R>>;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Eval only: another model of the role's provider. */
  model?: string;
}

export interface LlmClient {
  /** The model of the role's row in the role table. */
  modelOf(role: LlmRole): string;
  generate<T, R extends LlmRole>(call: LlmCall<T, R>): Promise<{ data: T; usage: LlmUsage }>;
}

type RateLimiter = ReturnType<typeof createRateLimiter>;
type ProviderRegistry = Record<LlmProviderId, Pick<LlmProvider, "createGenerate" | "classifyError">>;

export function createLlmClient(opts: {
  table: LlmRoleTable;
  /** Tests: fake providers. Default: the provider registry. */
  providers?: Partial<ProviderRegistry>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): LlmClient {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const providerOf = (id: LlmProviderId) => opts.providers?.[id] ?? llmProviders[id];
  // One limiter per provider (its rate limit is shared by all roles) and one per role with its own rpm.
  const providerLimiters = new Map<LlmProviderId, RateLimiter>();
  const roleLimiters = new Map<LlmRole, RateLimiter>();
  // One generate per provider and effort: the OpenAI adapter binds the effort when it is built.
  const generators = new Map<string, GenerateFn>();

  const providerLimiter = (id: LlmProviderId): RateLimiter => {
    let limiter = providerLimiters.get(id);
    if (limiter === undefined) {
      limiter = createRateLimiter({ rpm: opts.table.providers[id].rpm, now, sleep });
      providerLimiters.set(id, limiter);
    }
    return limiter;
  };
  const roleLimiter = (role: LlmRole, rpm: number): RateLimiter => {
    let limiter = roleLimiters.get(role);
    if (limiter === undefined) {
      limiter = createRateLimiter({ rpm, now, sleep });
      roleLimiters.set(role, limiter);
    }
    return limiter;
  };
  const generatorOf = (row: LlmRoleSettings, model: string): GenerateFn => {
    const key = `${row.provider}:${row.reasoningEffort ?? ""}`;
    let generate = generators.get(key);
    if (generate === undefined) {
      const apiKey = opts.table.providers[row.provider].apiKey;
      if (apiKey === undefined) throw new LlmConfigError("missing_key", model);
      generate = providerOf(row.provider).createGenerate({ apiKey, reasoningEffort: row.reasoningEffort });
      generators.set(key, generate);
    }
    return generate;
  };

  return {
    modelOf: (role) => opts.table.roles[role].model,

    async generate(call) {
      const row = opts.table.roles[call.role];
      const model = call.model ?? row.model;
      if (row.rpm !== null) await roleLimiter(call.role, row.rpm).acquire();
      await providerLimiter(row.provider).acquire();
      const started = now();
      try {
        const generate = generatorOf(row, model);
        const result = await withTimeout(
          generate({
            model,
            system: call.system,
            prompt: call.prompt,
            jsonSchema: z.toJSONSchema(call.schema),
            signal: AbortSignal.timeout(row.timeoutMs),
          }),
          row.timeoutMs,
          model
        );
        const data = parseOutput(result, call.schema, model);
        const usage: LlmUsage = {
          role: call.role,
          promptVersion: call.promptVersion,
          model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          latencyMs: now() - started,
        };
        log.debug("llm_call_ok", {
          role: call.role,
          model,
          ms: usage.latencyMs,
          tokens_in: usage.tokensIn,
          tokens_out: usage.tokensOut,
        });
        return { data, usage };
      } catch (error) {
        const llmError = isLlmError(error) ? error : providerOf(row.provider).classifyError(error, model);
        log.debug("llm_call_failed", { role: call.role, model, code: llmError.code });
        throw llmError;
      }
    },
  };
}
