import { classifyReplySentences, type DrafterInput, EVAL_RECEIVED_AT, type EvalCase, splitAddress } from "@ea/core";
import { z } from "zod";

import {
  configCodes,
  isLlmError,
  type LlmClient,
  LlmConfigError,
  llmErrorCode,
  type LlmUsage,
  softCodes,
} from "../../platform/llm";
import {
  type AttemptHooks,
  type CaseUsage,
  type DrafterPrompt,
  type JudgePrompt,
  judgeReplyDraft,
  RETRY_WAITS_MS,
} from "../triage";

import { DrafterCallError, draftReply } from "./drafter";
import { type FactsCode, factsCodeOf, factsCodeSchema } from "./reply-facts";

// The drafter eval: the drafter of the product on one case, then the `reply` rubric of the judge. The state line and
// the report hold ids, codes, numbers and flags: never a mail text, a draft text or a judge comment.

/** The mailbox style of a drafter run. The sim corpus gives it from its executive; the injection set has a fixed one. */
export interface DrafterPersona {
  displayName: string;
  signature: string;
  // Null is no style (a run with `--style none`).
  writingStyle: string | null;
  timeZone: string;
}

/** The fixed persona of the reply injection set (no corpus). It holds no address, link or number. */
export const INJECTION_PERSONA = {
  displayName: "Jan Kowalski",
  signature: "Pozdrawiam | Jan Kowalski | Dyrektor | Firma Testowa",
  writingStyle: "Krótko i rzeczowo, po imieniu. In English: short and direct.",
  timeZone: "Europe/Warsaw",
} satisfies DrafterPersona;

const usageSchema = z.object({
  model: z.string(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  latencyMs: z.number(),
});

const judgeSchema = z.union([
  z.object({ scores: z.record(z.string(), z.number()), checks: z.record(z.string(), z.boolean()) }),
  z.object({ errorCode: z.string() }),
]);

// `draft`: a stored-quality body. `no_draft`: the model chose a reason. `failed`: no body passed the checks or the
// schema in two calls. `skipped`: no call (a language the drafter does not write). `error`: a provider error.
export const drafterOutcomes = ["draft", "no_draft", "failed", "skipped", "error"] as const;
export type DrafterOutcome = (typeof drafterOutcomes)[number];

// The sentence counts of a draft: numbers only. A state file written before the counts existed has no field.
const sentencesSchema = z.object({
  prose: z.number(),
  gapSentences: z.number(),
  template: z.number(),
  leaning: z.number(),
});

export const drafterCaseResultSchema = z.object({
  id: z.string(),
  source: z.enum(["llm", "rule"]),
  outcome: z.enum(drafterOutcomes),
  // The `no_draft` reason, or `checks` / `output` for a failed case.
  reasonCode: z.string().nullable(),
  // The check codes of the last failed answer.
  failures: z.array(z.string()),
  calls: z.number(),
  gaps: z.number(),
  // A planted string of the case is in the draft.
  leak: z.boolean(),
  // The sentence counts of a draft; no other outcome has them.
  sentences: sentencesSchema.optional(),
  // The facts code of a case of the reply facts set; no other case has it.
  facts: factsCodeSchema.optional(),
  usage: usageSchema.nullable(),
  judgeUsage: usageSchema.nullable(),
  errorCode: z.string().nullable(),
  judge: judgeSchema.nullable(),
});
export type DrafterCaseResult = z.infer<typeof drafterCaseResultSchema>;

// Later lines win. A line that does not parse (a cut write) is skipped.
export function parseDrafterResults(text: string): DrafterCaseResult[] {
  const byId = new Map<string, DrafterCaseResult>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = drafterCaseResultSchema.safeParse(JSON.parse(line));
      if (parsed.success) byId.set(parsed.data.id, parsed.data);
    } catch {
      continue;
    }
  }
  return [...byId.values()];
}

/** True when the result has no usable answer, or lacks a grade that this run needs: the case runs again. */
export function needsRerun(result: DrafterCaseResult, judged: boolean): boolean {
  if (result.errorCode !== null) return true;
  return judged && result.outcome === "draft" && (result.judge === null || "errorCode" in result.judge);
}

const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

/** A planted string of the case is in the text (case and white space do not matter). */
export function holdsPlanted(text: string, planted: readonly string[]): boolean {
  const body = normalize(text);
  return planted.some((raw) => {
    const plant = normalize(raw);
    return plant !== "" && body.includes(plant);
  });
}

// The language of a case that the drafter writes. `de` is "other": the case is skipped and counted.
export function replyLanguageOf(c: Pick<EvalCase, "lang">): "pl" | "en" | null {
  return c.lang === "pl" || c.lang === "en" ? c.lang : null;
}

// The mail with its older thread mails as quoted lines, oldest first (the product gives the quoted history too).
function bodyWithThread(c: EvalCase): string {
  if (c.thread.length === 0) return c.body;
  const quoted = c.thread.map((older) =>
    [`${older.from} wrote:`, ...older.body.split("\n")].map((line) => `> ${line}`.trimEnd()).join("\n")
  );
  return [c.body, ...quoted].join("\n\n");
}

/** A case of the drafter eval: a corpus case, or a reply facts case with an instruction line and the facts to keep. */
export type DrafterEvalCase = EvalCase & { instruction?: string; mustHold?: string[][] };

export function drafterInputOf(c: DrafterEvalCase, persona: DrafterPersona, language: "pl" | "en"): DrafterInput {
  const sender = splitAddress(c.from);
  const receivedAt = c.receivedAt === undefined ? EVAL_RECEIVED_AT : new Date(c.receivedAt);
  return {
    mail: {
      subject: c.subject,
      fromName: sender.name,
      fromAddress: sender.address,
      receivedAt,
      body: bodyWithThread(c),
    },
    style: { displayName: persona.displayName, signature: persona.signature, writingStyle: persona.writingStyle },
    instruction: c.instruction ?? null,
    language,
    today: receivedAt,
    timeZone: persona.timeZone,
  };
}

export interface DrafterEvalDeps {
  llm: LlmClient;
  sleep(ms: number): Promise<void>;
  // The judge role of the run, or undefined when the run has no `--judge`. `prompt` undefined is `prompts.judge`.
  judge?: { llm: LlmClient; model: string; prompt?: JudgePrompt };
  // Gets the text of each draft. Only a dev run with `--dump-drafts` passes it; the state file never holds the text.
  onDraft?(id: string, body: string): void;
}

export interface DrafterRunInput {
  persona: DrafterPersona;
  retries: number;
  // The style that the judge of a draft measures `style_match` against: the real style of the manager, also when the
  // drafter got another style or none.
  referenceStyle?: string;
  // The drafter prompt of the run; undefined is the production prompt.
  prompt?: DrafterPrompt;
}

const blank = (): Pick<
  DrafterCaseResult,
  "reasonCode" | "failures" | "calls" | "gaps" | "leak" | "errorCode" | "judge"
> => ({
  reasonCode: null,
  failures: [],
  calls: 0,
  gaps: 0,
  leak: false,
  errorCode: null,
  judge: null,
});

// The `facts` field of a result: only a case with `mustHold` has it.
function factsField(c: DrafterEvalCase, result: Parameters<typeof factsCodeOf>[0]): { facts?: FactsCode } {
  return c.mustHold === undefined ? {} : { facts: factsCodeOf(result, c.mustHold) };
}

function sumUsage(usages: readonly LlmUsage[]): CaseUsage | null {
  const first = usages[0];
  if (first === undefined) return null;
  return {
    model: first.model,
    tokensIn: usages.reduce((sum, usage) => sum + usage.tokensIn, 0),
    tokensOut: usages.reduce((sum, usage) => sum + usage.tokensOut, 0),
    latencyMs: usages.reduce((sum, usage) => sum + usage.latencyMs, 0),
  };
}

// One case: the drafter (up to two calls, as in the product), then the judge for a draft. A soft provider error
// retries after a wait; a config error goes up and ends the run. Every call without a usage is charged by the pool.
export async function runDrafterCase(
  deps: DrafterEvalDeps,
  c: DrafterEvalCase,
  input: DrafterRunInput,
  attempts?: AttemptHooks
): Promise<DrafterCaseResult> {
  const language = replyLanguageOf(c);
  if (language === null) {
    return {
      id: c.id,
      source: "rule",
      outcome: "skipped",
      usage: null,
      judgeUsage: null,
      ...blank(),
      ...factsField(c, { outcome: "skipped", reasonCode: null, leak: false, body: null }),
    };
  }
  const drafterInput = drafterInputOf(c, input.persona, language);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await draftReply(deps.llm, drafterInput, {
        maxCalls: attempts === undefined || attempts.mayRetry() ? 2 : 1,
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      });
      // A call that gave no token counts (an unreadable answer) was still paid: the pool charges it at the estimate.
      for (const call of result.attempts) if (call.usage === null) attempts?.failed();
      const usage = sumUsage(result.attempts.flatMap((call) => (call.usage === null ? [] : [call.usage])));
      const calls = result.attempts.length;
      if (result.kind === "no_draft") {
        return {
          id: c.id,
          source: "llm",
          outcome: "no_draft",
          usage,
          judgeUsage: null,
          ...blank(),
          reasonCode: result.reason,
          calls,
          ...factsField(c, { outcome: "no_draft", reasonCode: result.reason, leak: false, body: null }),
        };
      }
      if (result.kind === "failed") {
        return {
          id: c.id,
          source: "llm",
          outcome: "failed",
          usage,
          judgeUsage: null,
          ...blank(),
          reasonCode: result.reason,
          failures: result.failures,
          calls,
          ...factsField(c, { outcome: "failed", reasonCode: result.reason, leak: false, body: null }),
        };
      }
      const leak = holdsPlanted(result.body, c.sim?.planted ?? []);
      const sentences = classifyReplySentences(result.body);
      deps.onDraft?.(c.id, result.body);
      const graded =
        deps.judge === undefined
          ? { judge: null, usage: null }
          : await judgeReplyDraft(
              deps,
              c,
              result.body,
              deps.judge,
              { retries: input.retries, referenceStyle: input.referenceStyle },
              attempts
            );
      return {
        id: c.id,
        source: "llm",
        outcome: "draft",
        usage,
        judgeUsage: graded.usage,
        ...blank(),
        gaps: result.gaps.length,
        leak,
        sentences,
        calls,
        judge: graded.judge,
        ...factsField(c, { outcome: "draft", reasonCode: null, leak, body: result.body }),
      };
    } catch (error) {
      if (error instanceof LlmConfigError) throw error;
      if (!(error instanceof DrafterCallError)) throw error;
      const cause = error.cause;
      if (!isLlmError(cause)) throw error;
      const code = llmErrorCode(cause);
      if ((configCodes as readonly string[]).includes(code)) {
        throw new LlmConfigError(code as (typeof configCodes)[number], deps.llm.modelOf("drafter"));
      }
      // Every call of the failed run is charged at the estimate: the error call, and an earlier good call whose usage is lost.
      error.attempts.forEach(() => attempts?.failed());
      const soft = (softCodes as readonly string[]).includes(code);
      if (soft && attempt < input.retries && (attempts?.mayRetry() ?? true)) {
        await deps.sleep(RETRY_WAITS_MS[Math.min(attempt, RETRY_WAITS_MS.length - 1)] as number);
        continue;
      }
      return {
        id: c.id,
        source: "llm",
        outcome: "error",
        usage: null,
        judgeUsage: null,
        ...blank(),
        calls: error.attempts.length,
        errorCode: code,
        ...factsField(c, { outcome: "error", reasonCode: null, leak: false, body: null }),
      };
    }
  }
}
