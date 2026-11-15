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

import { isLlmError, type LlmClient, LlmOutputError, type LlmUsage } from "../../platform/llm";
import { prompts } from "../triage";

// `usages` holds one entry per attempt: the caller writes one `llm.call` row for each. An answer that the client could
// not read has no token counts; its entry has zero tokens.
export type DrafterResult =
  | { kind: "draft"; body: string; gaps: string[]; usages: LlmUsage[] }
  | { kind: "no_draft"; reason: NoDraftReason; usages: LlmUsage[] }
  | { kind: "failed"; reason: "checks" | "output"; failures: ReplyCheckCode[]; usages: LlmUsage[] };

/**
 * A provider error (timeout, quota, bad key, blocked) in an attempt. The error is not about the mail or the draft:
 * the caller retries later or fails by the error code. `usages` holds the attempts that finished before it.
 */
export class DrafterCallError extends Error {
  constructor(
    readonly cause: unknown,
    readonly usages: LlmUsage[]
  ) {
    super("drafter call failed");
    this.name = "DrafterCallError";
  }
}

const MAX_ATTEMPTS = 2;

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
 */
export async function draftReply(llm: LlmClient, input: DrafterInput): Promise<DrafterResult> {
  const prompt = prompts.drafter;
  const allowed = allowedOf(input);
  const usages: LlmUsage[] = [];
  let retry: Parameters<typeof prompt.buildUser>[2];
  let last: Attempt = { kind: "output" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const started = Date.now();
    try {
      const { data, usage } = await llm.generate({
        role: prompt.role,
        promptVersion: prompt.version,
        schema: drafterOutputSchema,
        system: prompt.buildSystem(),
        prompt: prompt.buildUser(input, randomBytes(16).toString("hex"), retry),
      });
      usages.push(usage);
      if (data.decision === "no_draft") return { kind: "no_draft", reason: data.reason_code ?? "needs_facts", usages };
      const body = normalizeDraftText(data.body);
      const checked = checkReplyBody(body, { language: input.language, allowed });
      if (checked.ok) return { kind: "draft", body, gaps: gapsOf(body), usages };
      last = { kind: "draft", body, failures: checked.failures };
      retry = { reason: "checks", failures: checked.failures };
    } catch (error) {
      if (!(error instanceof LlmOutputError)) {
        // Anything that is no LLM error is a bug and goes up. A provider error ends the call; the usages stay.
        if (!isLlmError(error)) throw error;
        throw new DrafterCallError(error, usages);
      }
      usages.push({
        role: prompt.role,
        promptVersion: prompt.version,
        model: llm.modelOf(prompt.role),
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
        endpoint: llm.endpointOf(prompt.role),
      });
      last = { kind: "output" };
      retry = { reason: "output" };
    }
  }
  if (last.kind === "draft") return { kind: "failed", reason: "checks", failures: last.failures, usages };
  return { kind: "failed", reason: "output", failures: [], usages };
}
