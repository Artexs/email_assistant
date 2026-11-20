import { randomBytes } from "node:crypto";

import { checkProfileInput, checkStyleSuggestion, type StyleCheckCode, stylistOutputSchema } from "@ea/core";

import { isLlmError, type LlmClient, llmErrorCode, LlmOutputError, type LlmUsage } from "../../platform/llm";
import { prompts, type StylistPrompt } from "../triage";

// One model call. The caller records the cost of every call, also one that gave no usable answer. `outcome` is `ok`
// (the answer was read, whatever the checks said), `bad_output` (the answer could not be read) or the code of the
// LLM error. `usage` is null when the call gave no token counts.
export interface StylistAttempt {
  outcome: string;
  usage: LlmUsage | null;
  latencyMs: number;
}

export type StylistResult =
  | { kind: "suggestion"; text: string; attempts: StylistAttempt[] }
  | { kind: "failed"; reason: "checks"; failures: StyleCheckCode[]; attempts: StylistAttempt[] }
  | { kind: "failed"; reason: "output"; failures: []; attempts: StylistAttempt[] };

/**
 * A provider error (timeout, quota, bad key, blocked) in an attempt. The error is not about the samples or the text:
 * the caller reports it by its code. `attempts` holds the calls up to and including the failed one.
 */
export class StylistCallError extends Error {
  constructor(
    readonly cause: unknown,
    readonly attempts: StylistAttempt[]
  ) {
    super("stylist call failed");
    this.name = "StylistCallError";
  }
}

export const STYLIST_MAX_CALLS = 2;

export interface StylistInput {
  /** The cut texts of the sent mail, from `buildStyleSamples`. */
  samples: readonly string[];
  /** The name tokens of `buildStyleSamples`: the check rejects a text that holds one. */
  names: readonly string[];
  language: "pl" | "en";
}

/**
 * One stylist call, with one retry after an unreadable answer or a failed check. LLM text is untrusted: Zod checks the
 * answer and `checkStyleSuggestion` checks the text, with no allowed list. The retry prompt names the failure codes,
 * never the failed text. The text that leaves is the cleaned text of `checkProfileInput`, the check of the Save of the
 * card, so that Save takes it as typed.
 * `maxCalls` (1 or 2, default 2) is the spend that the caller still has: with 1 there is no retry.
 * `prompt` is the production prompt (`prompts.stylist`); only the stylist eval passes another version.
 */
export async function suggestStyle(
  llm: LlmClient,
  input: StylistInput,
  opts: { maxCalls?: number; prompt?: StylistPrompt } = {}
): Promise<StylistResult> {
  const prompt = opts.prompt ?? prompts.stylist;
  const maxCalls = Math.min(STYLIST_MAX_CALLS, Math.max(1, Math.floor(opts.maxCalls ?? STYLIST_MAX_CALLS)));
  const attempts: StylistAttempt[] = [];
  let retry: Parameters<typeof prompt.buildUser>[0]["retry"];
  let failures: StyleCheckCode[] | null = null;

  for (let attempt = 1; attempt <= maxCalls; attempt += 1) {
    const started = Date.now();
    try {
      const { data, usage } = await llm.generate({
        role: prompt.role,
        promptVersion: prompt.version,
        schema: stylistOutputSchema,
        system: prompt.buildSystem(),
        prompt: prompt.buildUser({
          samples: input.samples,
          language: input.language,
          nonce: randomBytes(16).toString("hex"),
          retry,
        }),
      });
      attempts.push({ outcome: "ok", usage, latencyMs: usage.latencyMs });
      const checked = checkStyleSuggestion(data.style, {
        names: input.names,
        samples: input.samples,
        language: input.language,
      });
      if (checked.ok) {
        const profile = checkProfileInput({ writingStyle: data.style });
        const text = profile.ok ? profile.fields.writingStyle : null;
        if (text !== null && text !== undefined) return { kind: "suggestion", text, attempts };
        failures = null;
        retry = { reason: "output" };
      } else {
        failures = checked.failures;
        retry = { reason: "checks", failures: checked.failures };
      }
    } catch (error) {
      // Anything that is no LLM error is a bug and goes up.
      if (!isLlmError(error)) throw error;
      attempts.push({ outcome: llmErrorCode(error), usage: null, latencyMs: Date.now() - started });
      // A provider error ends the call; the attempts so far stay for the cost.
      if (!(error instanceof LlmOutputError)) throw new StylistCallError(error, attempts);
      failures = null;
      retry = { reason: "output" };
    }
  }
  return failures === null
    ? { kind: "failed", reason: "output", failures: [], attempts }
    : { kind: "failed", reason: "checks", failures, attempts };
}
