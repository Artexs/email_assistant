import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";

import type { GenerateFn, GenerateRequest, GenerateResult } from "../client";
import { isNetworkError, isRecord, LlmConfigError, LlmHardError, LlmSoftError } from "../errors";
import type { ConfigCode, SoftCode } from "../errors";

import type { LlmProvider } from "./index";

/** Keywords that strict mode rejects. Stage 0 case A: none, only the root `$schema` goes. */
const REJECTED_KEYWORDS: ReadonlySet<string> = new Set();
const SCHEMA_CACHE_LIMIT = 64;

const schemaCache = new Map<string, Record<string, unknown>>();

/** The fields of a Responses API answer that `toOpenAiResult` reads. */
export interface OpenAiResponseLike {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: { type: string; content?: { type: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Deep copy without `$schema` and without the rejected keywords. Throws when an object node is not strict. */
function strictNode(node: unknown, model: string): unknown {
  if (Array.isArray(node)) return node.map((item) => strictNode(item, model));
  if (!isRecord(node)) return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (REJECTED_KEYWORDS.has(key)) continue;
    // `properties` and `$defs` map names to schemas: a property may have the name of a keyword.
    if ((key === "properties" || key === "$defs") && isRecord(value)) {
      copy[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, strictNode(child, model)]));
    } else if (key === "items" || key === "anyOf") {
      copy[key] = strictNode(value, model);
    } else {
      copy[key] = structuredClone(value);
    }
  }
  if (node.type === "object" || isRecord(node.properties)) {
    const keys = isRecord(node.properties) ? Object.keys(node.properties) : [];
    const required: unknown[] = Array.isArray(node.required) ? node.required : [];
    if (node.additionalProperties !== false || !keys.every((key) => required.includes(key))) {
      throw new LlmConfigError("schema_not_strict", model);
    }
  }
  return copy;
}

/** The JSON Schema in the form that OpenAI strict mode accepts. It adds nothing: a loose schema throws. */
export function toStrictJsonSchema(jsonSchema: unknown, model: string): Record<string, unknown> {
  const cacheKey = JSON.stringify(jsonSchema);
  const cached = schemaCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const copy = strictNode(jsonSchema, model);
  if (!isRecord(copy)) throw new LlmConfigError("schema_not_strict", model);
  delete copy.$schema;
  if (schemaCache.size >= SCHEMA_CACHE_LIMIT) schemaCache.clear();
  schemaCache.set(cacheKey, copy);
  return copy;
}

export function toResponseParams(
  req: GenerateRequest,
  reasoningEffort: string | null
): ResponseCreateParamsNonStreaming {
  return {
    model: req.model,
    instructions: req.system,
    input: req.prompt,
    text: {
      format: {
        type: "json_schema",
        name: "result",
        strict: true,
        schema: toStrictJsonSchema(req.jsonSchema, req.model),
      },
    },
    store: false,
    // The cast is safe: config limits OPENAI_REASONING_EFFORT to the values of the SDK type.
    ...(reasoningEffort === null ? {} : { reasoning: { effort: reasoningEffort as ReasoningEffort } }),
  };
}

export function toOpenAiResult(response: OpenAiResponseLike): GenerateResult {
  const tokensIn = response.usage?.input_tokens ?? 0;
  // The output tokens already hold the reasoning tokens.
  const tokensOut = response.usage?.output_tokens ?? 0;
  const refused = (response.output ?? []).some(
    (item) => item.type === "message" && (item.content ?? []).some((part) => part.type === "refusal")
  );
  if (refused) return { text: undefined, tokensIn, tokensOut, blocked: true };
  if (response.status === "incomplete") {
    return { text: undefined, tokensIn, tokensOut, blocked: response.incomplete_details?.reason === "content_filter" };
  }
  return { text: response.output_text, tokensIn, tokensOut, blocked: false };
}

/** Used only by `createOpenAiGenerate`; the options are fixed because our pause logic retries. */
export const openAiClientOptions = (apiKey: string) => ({ apiKey, maxRetries: 0 });

/** The part of the SDK client that the adapter calls (the tests pass a fake). */
export interface OpenAiLike {
  responses: {
    create(params: ResponseCreateParamsNonStreaming, options: { signal: AbortSignal }): Promise<OpenAiResponseLike>;
  };
}

const SOFT_STATUSES = new Set([429, 500, 502, 503, 504]);
const CONFIG_STATUSES = new Set([401, 402, 403, 404]);

/** Reads only the class, `status`, `code`, `type` and `param`: never `message` or the body. */
export function classifyOpenAiError(error: unknown, model: string): LlmSoftError | LlmConfigError | LlmHardError {
  if (!isRecord(error)) return new LlmHardError("unknown", model);
  // The timeout class is a child of APIConnectionError: check it first.
  // A timeout signal gives APIUserAbortError, not the timeout class (stage 0 note, case H).
  if (
    error instanceof OpenAI.APIUserAbortError ||
    error instanceof OpenAI.APIConnectionTimeoutError ||
    error.name === "AbortError" ||
    error.name === "TimeoutError"
  ) {
    return new LlmSoftError("timeout", model);
  }
  if (error instanceof OpenAI.APIConnectionError) return new LlmSoftError("network", model);
  const status = error.status;
  if (typeof status !== "number") {
    return isNetworkError(error) ? new LlmSoftError("network", model) : new LlmHardError("unknown", model);
  }
  if (status === 429 && (error.type === "insufficient_quota" || error.code === "insufficient_quota")) {
    return new LlmConfigError("http_429_quota", model);
  }
  if (SOFT_STATUSES.has(status)) return new LlmSoftError(`http_${status}` as SoftCode, model);
  if (status >= 500 && status <= 599) return new LlmSoftError("http_5xx", model);
  if (CONFIG_STATUSES.has(status)) return new LlmConfigError(`http_${status}` as ConfigCode, model);
  if (status === 400) {
    return error.code === "invalid_json_schema"
      ? new LlmConfigError("http_400_schema", model)
      : new LlmHardError("http_400", model);
  }
  return new LlmHardError(`http_${status}`, model);
}

export function createOpenAiGenerate(opts: {
  apiKey: string;
  reasoningEffort: string | null;
  client?: OpenAiLike;
}): GenerateFn {
  const client: OpenAiLike = opts.client ?? new OpenAI(openAiClientOptions(opts.apiKey));
  return async (req) =>
    toOpenAiResult(await client.responses.create(toResponseParams(req, opts.reasoningEffort), { signal: req.signal }));
}

export const openaiProvider: LlmProvider = {
  label: "OpenAI",
  configHint: "check OPENAI_API_KEY, OPENAI_MODEL_CLASSIFIER and the OpenAI project (billing, budget, model access)",
  createGenerate: (opts) => createOpenAiGenerate(opts),
  classifyError: classifyOpenAiError,
};
