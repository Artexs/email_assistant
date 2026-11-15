import { randomBytes } from "node:crypto";

import { type ExtractorOutput, extractorInputOf, extractorOutputSchema, resolveDue } from "@ea/core";

import { isLlmError, type LlmClient, LlmOutputError, llmErrorCode, type LlmUsage } from "../../platform/llm";
import { prompts } from "../triage";

// A mail of the user that the code filters passed, as `extractSent` reads it.
export interface ExtractMail {
  subject: string | null;
  bodyText: string;
  sentAt: Date;
  to: readonly string[];
  cc: readonly string[];
}

// What the model found, with the dates resolved by code. A date that the code refuses (past, over 60 days, not a
// day) is null. The model text of `ask` and `promise` passed the code rules of `extractorOutputSchema`.
export interface Extraction {
  expectsReply: boolean;
  ask: string | null;
  due: Date | null;
  promise: string | null;
  promiseDue: Date | null;
  language: "pl" | "en" | "other";
}

// `schema`: the answer broke the schema. Any other code is the code of the provider error (`llmErrorCode`). The
// error holds no mail text. The caller writes the `llm.call` row from `usage` and the code.
export type ExtractResult = { ok: true; result: Extraction; usage: LlmUsage } | { ok: false; code: string };

// One LLM call for one mail of the user. LLM text is untrusted: it only passes Zod and the code rules, and it is
// never an address, a folder or a command.
export async function extractSent(
  llm: LlmClient,
  mail: ExtractMail,
  opts: { timeZone: string }
): Promise<ExtractResult> {
  const prompt = prompts.extractor;
  const input = extractorInputOf(mail, opts.timeZone);
  let answered: { data: ExtractorOutput; usage: LlmUsage };
  try {
    answered = await llm.generate({
      role: prompt.role,
      promptVersion: prompt.version,
      schema: extractorOutputSchema,
      system: prompt.buildSystem(),
      prompt: prompt.buildUser(input, randomBytes(16).toString("hex")),
    });
  } catch (error) {
    if (error instanceof LlmOutputError) return { ok: false, code: "schema" };
    // The client wraps every error of a provider in an LLM error. Anything else is a bug and goes up.
    if (!isLlmError(error)) throw error;
    return { ok: false, code: llmErrorCode(error) };
  }
  const { data, usage } = answered;
  const context = { sentAt: mail.sentAt, timeZone: opts.timeZone };
  return {
    ok: true,
    usage,
    result: {
      expectsReply: data.expects_reply,
      ask: data.ask,
      due: data.due === null ? null : resolveDue(data.due, context),
      promise: data.promise,
      promiseDue: data.promise_due === null ? null : resolveDue(data.promise_due, context),
      language: data.language,
    },
  };
}
