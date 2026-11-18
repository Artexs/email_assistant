import { randomBytes } from "node:crypto";

import { buildTriageAnalysisSchema, type Category, markUntrustedText, type TriageAnalysis } from "@ea/core";

import { type LlmClient, LlmOutputError, type LlmUsage } from "../../platform/llm";

import { classifierVersions, type ClassifierPromptChoice, productionClassifierChoice } from "./prompts";
import type { ClassifierDelegate } from "./prompts/classifier-v2";

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

// What the user's own data adds to one mail (F109 stage 08, decision D10). `classifier-v2` ignores it. Counts and
// names only: no text of another mail leaves the readers (P4). Absent extras mean all empty or null.
export interface ClassifierExtras {
  // Non-inline attachments, at most 10. Names are untrusted mail data.
  attachments: { name: string | null; type: string; size: number | null }[];
  // The mail has a List-Id or a List-Unsubscribe header.
  isList: boolean;
  // Counts of earlier mail of this sender. No model labels (review N2). Null for a flagged mail: a forged
  // address must not inherit a good history.
  senderHistory: {
    days: number;
    received: number;
    // The `true_category` of the user's "wrong" feedback.
    corrections: Partial<Record<Category, number>>;
  } | null;
  // The user's urgency profile. `today` is a local date (YYYY-MM-DD); deadlines are due within today−1 … today+30.
  urgency: {
    today: string;
    topics: { label: string; keywords: string[] }[];
    deadlines: { label: string; due: string }[];
  } | null;
}

export const EMPTY_EXTRAS: ClassifierExtras = { attachments: [], isList: false, senderHistory: null, urgency: null };

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
    // Absent: all empty or null.
    extras?: ClassifierExtras;
    // Absent: the production prompt. The eval picks another version and part list.
    prompt?: ClassifierPromptChoice;
  }
): Promise<{ analysis: TriageAnalysis; usage: LlmUsage; promptVersion: string }> {
  const nonce = randomBytes(16).toString("hex");
  const choice = input.prompt ?? productionClassifierChoice();
  const prompt = classifierVersions[choice.version];
  const { data, usage } = await llm.generate({
    role: prompt.role,
    promptVersion: prompt.version,
    schema: buildTriageAnalysisSchema(
      input.allowed,
      input.delegates.map((d) => d.id)
    ),
    system: prompt.buildSystem(input.allowed, choice.parts),
    prompt: prompt.buildUser(
      input.email,
      input.sender,
      input.delegates,
      nonce,
      input.extras ?? EMPTY_EXTRAS,
      choice.parts
    ),
    model: input.model,
  });
  return { ...finishAnalysis(data, input, llm), usage, promptVersion: prompt.version };
}

// The checks and the marking of untrusted text that both calls share.
function finishAnalysis(
  data: TriageAnalysis,
  input: { allowed: readonly Category[]; delegates: readonly ClassifierDelegate[]; model?: string },
  llm: LlmClient
): { analysis: TriageAnalysis } {
  if (!input.allowed.includes(data.category)) throw new LlmOutputError(input.model ?? llm.modelOf("classifier"));

  const summary = data.category === "info" && data.summary !== null ? markUntrustedText(data.summary) : null;
  const delegateId = data.fields.delegate_id;
  const fields = {
    ...data.fields,
    delegate_id: delegateId !== null && input.delegates.some((d) => d.id === delegateId) ? delegateId : null,
    task: markedOrNull(data.fields.task),
    clarification: markedOrNull(data.fields.clarification),
  };
  return { analysis: { ...data, reason: markUntrustedText(data.reason), summary, fields } };
}
