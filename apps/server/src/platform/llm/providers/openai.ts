import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";

import type { GenerateRequest, GenerateResult } from "../client";
import { isRecord, LlmConfigError } from "../errors";

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
      copy[key] = value;
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
