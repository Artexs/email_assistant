import { randomBytes } from "node:crypto";

import { buildTriageAnalysisSchema, type Category, markUntrustedText, type TriageAnalysis } from "@ea/core";

import { type LlmClient, LlmOutputError, type LlmUsage } from "../../platform/llm";

import { buildSystemPrompt, buildUserPrompt, PROMPT_VERSION } from "./prompts/classifier-v1";

export interface ClassifierEmail {
  from: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  receivedAt: Date;
  bodyText: string | null;
  thread: { from: string | null; subject: string | null; receivedAt: Date; bodyExcerpt: string | null }[];
}

export interface SenderContext {
  whitelisted: boolean;
  vip: boolean;
  noreply: boolean;
}

// One LLM call per mail. LLM errors go to the caller unchanged.
export async function classifyEmail(
  llm: LlmClient,
  input: { email: ClassifierEmail; sender: SenderContext; allowed: readonly Category[]; model?: string }
): Promise<{ analysis: TriageAnalysis; usage: LlmUsage; promptVersion: string }> {
  const nonce = randomBytes(16).toString("hex");
  const { data, usage } = await llm.classify({
    schema: buildTriageAnalysisSchema(input.allowed),
    system: buildSystemPrompt(input.allowed),
    prompt: buildUserPrompt(input.email, input.sender, nonce),
    model: input.model,
  });
  if (!input.allowed.includes(data.category)) throw new LlmOutputError(input.model ?? llm.classifierModel);

  const summary = data.category === "info" && data.summary !== null ? markUntrustedText(data.summary) : null;
  const analysis: TriageAnalysis = { ...data, reason: markUntrustedText(data.reason), summary };
  return { analysis, usage, promptVersion: PROMPT_VERSION };
}
