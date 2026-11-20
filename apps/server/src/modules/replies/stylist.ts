import { randomBytes } from "node:crypto";

import { checkProfileInput, checkStyleSuggestion, type StyleCheckCode, stylistOutputSchema } from "@ea/core";

import { isLlmError, type LlmClient, llmErrorCode, LlmOutputError } from "../../platform/llm";
import { prompts, type StylistPrompt } from "../triage";

import type { DrafterAttempt } from "./drafter";

export type StylistResult =
  | { kind: "suggestion"; text: string; attempts: DrafterAttempt[] }
  | { kind: "failed"; reason: "checks" | "output"; failures: StyleCheckCode[]; attempts: DrafterAttempt[] };

/** A provider error (timeout, quota, bad key, blocked): `attempts` holds the calls up to and including the failed one. */
export class StylistCallError extends Error {
  constructor(
    readonly cause: unknown,
    readonly attempts: DrafterAttempt[]
  ) {
    super("stylist call failed");
    this.name = "StylistCallError";
  }
}

export const STYLIST_MAX_CALLS = 2;

type Last = { kind: "checks"; failures: StyleCheckCode[] } | { kind: "output" };

/**
 * One stylist call, with one retry after an unreadable answer or a failed check. LLM text is untrusted: Zod checks the answer
 * and `checkStyleSuggestion` checks the text (no allowed list: an address, a link or a number fails). The retry prompt names the
 * failure codes, never the failed text. The text that leaves is the cleaned text, so that Save accepts it as typed.
 * `maxCalls` (1 or 2, default 2) is the spend that the caller still has: with 1 there is no retry.
 * `prompt` is the production prompt (`prompts.stylist`); only the stylist eval passes another version.
 */
export async function suggestStyle(
  llm: LlmClient,
  input: { samples: readonly string[]; names: readonly string[]; language: "pl" | "en" },
  opts: { maxCalls?: number; prompt?: StylistPrompt } = {}
): Promise<StylistResult> {
  const prompt = opts.prompt ?? prompts.stylist;
  const maxCalls = Math.min(STYLIST_MAX_CALLS, Math.max(1, Math.floor(opts.maxCalls ?? STYLIST_MAX_CALLS)));
  const attempts: DrafterAttempt[] = [];
  let retry: Parameters<typeof prompt.buildUser>[1];
  let last: Last = { kind: "output" };

  for (let attempt = 1; attempt <= maxCalls; attempt += 1) {
    const started = Date.now();
    try {
      const { data, usage } = await llm.generate({
        role: prompt.role,
        promptVersion: prompt.version,
        schema: stylistOutputSchema,
        system: prompt.buildSystem(),
        prompt: prompt.buildUser(
          { samples: input.samples, language: input.language, nonce: randomBytes(16).toString("hex") },
          retry
        ),
      });
      attempts.push({ outcome: "ok", usage, latencyMs: usage.latencyMs });
      const checked = checkStyleSuggestion(data.style, {
        names: input.names,
        samples: input.samples,
        language: input.language,
      });
      if (!checked.ok) {
        last = { kind: "checks", failures: checked.failures };
        retry = { reason: "checks", failures: checked.failures };
        continue;
      }
      // The same check as the Save of the card, so the text that leaves is one that Save takes.
      const profile = checkProfileInput({ writingStyle: data.style });
      const text = profile.ok ? profile.fields.writingStyle : null;
      if (text === null || text === undefined) {
        last = { kind: "output" };
        retry = { reason: "output" };
        continue;
      }
      return { kind: "suggestion", text, attempts };
    } catch (error) {
      // Anything that is no LLM error is a bug and goes up.
      if (!isLlmError(error)) throw error;
      attempts.push({ outcome: llmErrorCode(error), usage: null, latencyMs: Date.now() - started });
      // A provider error ends the call; the attempts so far stay for the audit rows.
      if (!(error instanceof LlmOutputError)) throw new StylistCallError(error, attempts);
      last = { kind: "output" };
      retry = { reason: "output" };
    }
  }
  if (last.kind === "checks") return { kind: "failed", reason: "checks", failures: last.failures, attempts };
  return { kind: "failed", reason: "output", failures: [], attempts };
}
