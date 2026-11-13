import { randomBytes } from "node:crypto";

import { buildTriageAnalysisSchema, type Category, markUntrustedText, type TriageAnalysis } from "@ea/core";

import { type LlmClient, LlmOutputError, type LlmUsage } from "../../platform/llm";

import { buildSystemPrompt, buildUserPrompt, type ClassifierDelegate, PROMPT_VERSION } from "./prompts/classifier-v2";

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

function markedOrNull(text: string | null): string | null {
  const marked = text === null ? "" : markUntrustedText(text).trim();
  return marked === "" ? null : marked;
}

// One LLM call per mail. LLM errors go to the caller unchanged.
export async function classifyEmail(
  llm: LlmClient,
  input: {
    email: ClassifierEmail;
    sender: SenderContext;
    allowed: readonly Category[];
    delegates: readonly ClassifierDelegate[];
    model?: string;
  }
): Promise<{ analysis: TriageAnalysis; usage: LlmUsage; promptVersion: string }> {
  const nonce = randomBytes(16).toString("hex");
  const { data, usage } = await llm.generate({
    role: "classifier",
    promptVersion: PROMPT_VERSION,
    schema: buildTriageAnalysisSchema(
      input.allowed,
      input.delegates.map((d) => d.id)
    ),
    system: buildSystemPrompt(input.allowed),
    prompt: buildUserPrompt(input.email, input.sender, input.delegates, nonce),
    model: input.model,
  });
  if (!input.allowed.includes(data.category)) throw new LlmOutputError(input.model ?? llm.modelOf("classifier"));

  const summary = data.category === "info" && data.summary !== null ? markUntrustedText(data.summary) : null;
  const delegateId = data.fields.delegate_id;
  const fields = {
    ...data.fields,
    delegate_id: delegateId !== null && input.delegates.some((d) => d.id === delegateId) ? delegateId : null,
    task: markedOrNull(data.fields.task),
    clarification: markedOrNull(data.fields.clarification),
  };
  const analysis: TriageAnalysis = { ...data, reason: markUntrustedText(data.reason), summary, fields };
  return { analysis, usage, promptVersion: PROMPT_VERSION };
}
