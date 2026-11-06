import { type GenerateContentParameters, GoogleGenAI } from "@google/genai";

import type { GenerateFn, GenerateRequest, GenerateResult } from "../client";
import { isNetworkError, isRecord, LlmConfigError, LlmHardError, LlmSoftError } from "../errors";
import type { ConfigCode, SoftCode } from "../errors";

import type { LlmProvider } from "./index";

const SOFT_STATUSES = new Set([429, 500, 502, 503, 504]);
const CONFIG_STATUSES = new Set([401, 402, 403, 404]);
const BLOCK_FINISH_REASONS = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]);

interface GeminiResponse {
  text?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string }[];
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

export function classifyGeminiError(error: unknown, model: string): LlmSoftError | LlmConfigError | LlmHardError {
  if (!isRecord(error)) return new LlmHardError("unknown", model);
  if (error.name === "AbortError" || error.name === "TimeoutError") return new LlmSoftError("timeout", model);
  const status = error.status;
  if (typeof status !== "number") {
    return isNetworkError(error) ? new LlmSoftError("network", model) : new LlmHardError("unknown", model);
  }
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

export function toGeminiResult(response: GeminiResponse): GenerateResult {
  const text = response.text;
  const finishReason = response.candidates?.[0]?.finishReason;
  const blocked =
    response.promptFeedback?.blockReason !== undefined ||
    ((text?.trim() ?? "") === "" && finishReason !== undefined && BLOCK_FINISH_REASONS.has(finishReason));
  return {
    text,
    tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
    blocked,
  };
}

function createGenerate(opts: { apiKey: string }): GenerateFn {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  return async (req) => toGeminiResult(await ai.models.generateContent(toGenerateParams(req)));
}

export const geminiProvider: LlmProvider = {
  label: "Gemini",
  configHint: "check GEMINI_API_KEY, GEMINI_MODEL_CLASSIFIER and the Google project (billing, region)",
  createGenerate,
  classifyError: classifyGeminiError,
};
