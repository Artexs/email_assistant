import { randomBytes } from "node:crypto";

import {
  checkReplyBody,
  type DrafterInput,
  drafterOutputSchema,
  gapsOf,
  type NoDraftReason,
  normalizeDraftText,
  type ReplyCheckCode,
} from "@ea/core";

import { isLlmError, type LlmClient, llmErrorCode, LlmOutputError, type LlmUsage } from "../../platform/llm";
import { type DrafterPrompt, prompts } from "../triage";

// One model call. The caller writes one `llm.call` row for each, so every call counts in the daily cap, also a call
// that gave no usable answer. `outcome` is `ok` (the answer was read, whatever the checks said), `bad_output` (the
// answer could not be read) or the code of the LLM error. `usage` is null when the call gave no token counts.
export interface DrafterAttempt {
  outcome: string;
  usage: LlmUsage | null;
  latencyMs: number;
}

export type DrafterResult =
  | { kind: "draft"; body: string; gaps: string[]; attempts: DrafterAttempt[] }
  | { kind: "no_draft"; reason: NoDraftReason; attempts: DrafterAttempt[] }
  | { kind: "failed"; reason: "checks" | "output"; failures: ReplyCheckCode[]; attempts: DrafterAttempt[] };

/**
 * A provider error (timeout, quota, bad key, blocked) in an attempt. The error is not about the mail or the draft:
 * the caller retries later or fails by the error code. `attempts` holds the calls up to and including the failed one:
 * the last entry is the failed call (no usage, the error code as outcome).
 */
export class DrafterCallError extends Error {
  constructor(
    readonly cause: unknown,
    readonly attempts: DrafterAttempt[]
  ) {
    super("drafter call failed");
    this.name = "DrafterCallError";
  }
}

export const DRAFTER_MAX_CALLS = 2;

type Attempt =
  | { kind: "draft"; body: string; failures: ReplyCheckCode[] }
  | { kind: "no_draft"; reason: NoDraftReason }
  | { kind: "output" };

// The signature, the writing style and the instruction are the only texts whose addresses, links and numbers may
// appear in the body.
function allowedOf(input: DrafterInput): string[] {
  return [input.instruction, input.style.signature, input.style.writingStyle].filter(
    (text): text is string => text !== null && text.trim() !== ""
  );
}

/**
 * One drafter call, with one retry after an unreadable answer or a failed check. LLM text is untrusted: Zod checks
 * the answer, the code checks the body, and the answer never names a recipient, a folder or a command. The retry
 * prompt names the failure codes, never the failed text.
 * `maxCalls` (1 or 2, default 2) is the spend that the caller still has: with 1 there is no retry, and a first answer
 * that fails the checks ends the call as failed.
 * `prompt` is the production prompt (`prompts.drafter`); only the drafter eval passes another version.
 */
export async function draftReply(
  llm: LlmClient,
  input: DrafterInput,
  opts: { maxCalls?: number; prompt?: DrafterPrompt } = {}
): Promise<DrafterResult> {
  const prompt = opts.prompt ?? prompts.drafter;
  const allowed = allowedOf(input);
  const maxCalls = Math.min(DRAFTER_MAX_CALLS, Math.max(1, Math.floor(opts.maxCalls ?? DRAFTER_MAX_CALLS)));
  const attempts: DrafterAttempt[] = [];
  let retry: Parameters<typeof prompt.buildUser>[2];
  let last: Attempt = { kind: "output" };

  for (let attempt = 1; attempt <= maxCalls; attempt += 1) {
    const started = Date.now();
    try {
      const { data, usage } = await llm.generate({
        role: prompt.role,
        promptVersion: prompt.version,
        schema: drafterOutputSchema,
        system: prompt.buildSystem(),
        prompt: prompt.buildUser(input, randomBytes(16).toString("hex"), retry),
      });
      attempts.push({ outcome: "ok", usage, latencyMs: usage.latencyMs });
      if (data.decision === "no_draft")
        return { kind: "no_draft", reason: data.reason_code ?? "needs_facts", attempts };
      const body = normalizeDraftText(data.body);
      const checked = checkReplyBody(body, {
        language: input.language,
        allowed,
        quoted: [input.mail.subject ?? "", input.mail.body],
      });
      if (checked.ok) return { kind: "draft", body, gaps: gapsOf(body), attempts };
      last = { kind: "draft", body, failures: checked.failures };
      retry = { reason: "checks", failures: checked.failures };
    } catch (error) {
      // Anything that is no LLM error is a bug and goes up.
      if (!isLlmError(error)) throw error;
      attempts.push({ outcome: llmErrorCode(error), usage: null, latencyMs: Date.now() - started });
      // A provider error ends the call; the attempts so far stay for the audit rows.
      if (!(error instanceof LlmOutputError)) throw new DrafterCallError(error, attempts);
      last = { kind: "output" };
      retry = { reason: "output" };
    }
  }
  if (last.kind === "draft") return { kind: "failed", reason: "checks", failures: last.failures, attempts };
  return { kind: "failed", reason: "output", failures: [], attempts };
}
