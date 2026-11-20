import { randomBytes } from "node:crypto";

import { type DraftCheckCode, draftCodeChecks, type EvalCase, type PlannedAction, splitAddress } from "@ea/core";

import { SoftError } from "../../platform/errors";
import {
  LlmBlockedError,
  type LlmClient,
  LlmConfigError,
  llmErrorCode,
  type LlmProviderId,
  type LlmUsage,
} from "../../platform/llm";
import { createLog } from "../../platform/log";

import type { CaseResult, CaseUsage } from "./eval";
import { type AttemptHooks, RETRY_WAITS_MS } from "./eval-pool";
import { judgeDraft, judgePassed } from "./judge";
import type { JudgePrompt } from "./prompts";

const log = createLog("eval");

// What a sim run with `--judge` adds: the client that holds the judge role row, and an optional model of that row's provider.
export interface JudgeSetup {
  llm: LlmClient;
  // The judge role row of this run: the report names them.
  provider: LlmProviderId;
  model: string;
  // The address the eval gives a delegate: the expected recipient of a delegation draft.
  addressOf(delegateKey: string): string;
}

// The judge part of a case result. It holds scores, flags and codes: never a draft text or a judge comment.
export type CaseJudge =
  | {
      kind: "delegation";
      codeFailed: DraftCheckCode[];
      scores: Record<string, number>;
      checks: Record<string, boolean>;
      passed: boolean;
    }
  | { kind: "delegation"; errorCode: string }
  | null;

export function judgeFailed(judge: CaseJudge): boolean {
  return judge !== null && "errorCode" in judge;
}

// On a resume with `--judge`, an earlier result is reused when it needs no judge (no draft planned) or holds scores.
export function judgeReusable(result: Pick<CaseResult, "draftKind" | "judge">): boolean {
  return result.draftKind === "none" || (result.judge !== null && !judgeFailed(result.judge));
}

interface DraftToJudge {
  kind: "delegation" | "clarification";
  to: string[];
  text: string;
}

function draftOf(actions: PlannedAction[]): DraftToJudge | null {
  for (const action of actions) {
    if (action.type !== "create_draft") continue;
    const draft = action.draft;
    if (draft.kind === "delegation") return { kind: "delegation", to: draft.to, text: draft.task };
    if (draft.kind === "clarification") return { kind: "clarification", to: draft.to, text: draft.question };
  }
  return null;
}

// One judge call with the retry rule of the classifier calls: soft errors retry after a wait, a config error goes up.
// `{ errorCode }` is the final error; `usage` is what a good call used.
async function judgeWithRetry(
  deps: { sleep: (ms: number) => Promise<void> },
  caseId: string,
  retries: number,
  attempts: AttemptHooks | undefined,
  call: () => ReturnType<typeof judgeDraft>
): Promise<{ ok: Awaited<ReturnType<typeof judgeDraft>> } | { errorCode: string }> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { ok: await call() };
    } catch (error) {
      if (error instanceof LlmConfigError) throw error;
      attempts?.failed();
      if (!(error instanceof LlmBlockedError) && error instanceof SoftError && attempt < retries) {
        if (attempts?.mayRetry() ?? true) {
          const wait = RETRY_WAITS_MS[Math.min(attempt, RETRY_WAITS_MS.length - 1)] as number;
          log.warn("eval_judge_retry", { case_id: caseId, attempts: attempt + 1, wait_ms: wait });
          await deps.sleep(wait);
          continue;
        }
      }
      return { errorCode: llmErrorCode(error) };
    }
  }
}

const caseUsageOf = (usage: LlmUsage): CaseUsage => ({
  model: usage.model,
  tokensIn: usage.tokensIn,
  tokensOut: usage.tokensOut,
  latencyMs: usage.latencyMs,
});

// The judge pass of one case. No planned delegation or clarification draft: no call, `judge: null`.
// Soft errors retry like the classifier calls; a final error is `{ errorCode }` and the classifier result stays.
export async function judgeCaseDraft(
  deps: { sleep: (ms: number) => Promise<void> },
  c: EvalCase,
  actions: PlannedAction[],
  setup: JudgeSetup,
  input: { retries: number },
  attempts?: AttemptHooks
): Promise<{ judge: CaseJudge; usage: CaseUsage | null }> {
  const draft = draftOf(actions);
  if (draft === null) return { judge: null, usage: null };

  const expectedRecipient =
    draft.kind === "delegation"
      ? c.expected.delegate === undefined
        ? ""
        : setup.addressOf(c.expected.delegate)
      : splitAddress(c.from).address;
  const code = draftCodeChecks({
    draft,
    expectedRecipient,
    lang: c.lang,
    planted: c.sim?.planted ?? [],
  });

  const graded = await judgeWithRetry(deps, c.id, input.retries, attempts, () =>
    judgeDraft(
      setup.llm,
      {
        kind: "delegation",
        mail: { subject: c.subject, body: c.body },
        draft: draft.text,
        lang: c.lang,
        nonce: randomBytes(16).toString("hex"),
      },
      { model: setup.model }
    )
  );
  if (!("ok" in graded)) return { judge: { kind: "delegation", errorCode: graded.errorCode }, usage: null };
  const { result, usage } = graded.ok;
  return {
    judge: {
      kind: "delegation",
      codeFailed: code.failed,
      scores: result.scores,
      checks: result.checks,
      passed: judgePassed(result, code.passed),
    },
    usage: caseUsageOf(usage),
  };
}

// What the drafter eval keeps of one reply grade: scores and flags only, never a draft text or a judge comment.
export type ReplyJudge = { scores: Record<string, number>; checks: Record<string, boolean> } | { errorCode: string };

// The `reply` rubric for the draft of a case. The case brings its expected points and its `mustNot` lines. The code
// checks of the draft ran before (the drafter holds them), so `passed` is the rubric alone.
export async function judgeReplyDraft(
  deps: { sleep: (ms: number) => Promise<void> },
  c: EvalCase,
  draft: string,
  setup: Pick<JudgeSetup, "llm" | "model"> & { prompt?: JudgePrompt },
  // `referenceStyle` is the style the draft is measured against; only judge-v4 shows it.
  input: { retries: number; referenceStyle?: string },
  attempts?: AttemptHooks
): Promise<{ judge: ReplyJudge; usage: CaseUsage | null }> {
  const graded = await judgeWithRetry(deps, c.id, input.retries, attempts, () =>
    judgeDraft(
      setup.llm,
      {
        kind: "reply",
        mail: { subject: c.subject, body: c.body },
        // judge-v3 quotes the thread below the mail, as the drafter reads it; judge-v1 and judge-v2 ignore it.
        thread: c.thread.map((older) => ({ from: older.from, body: older.body })),
        draft,
        lang: c.lang,
        ...(c.sim?.expectedPoints === undefined ? {} : { expectedPoints: c.sim.expectedPoints }),
        ...(c.sim?.mustNot === undefined ? {} : { mustNot: c.sim.mustNot }),
        ...(input.referenceStyle === undefined ? {} : { referenceStyle: input.referenceStyle }),
        nonce: randomBytes(16).toString("hex"),
      },
      { model: setup.model, ...(setup.prompt === undefined ? {} : { prompt: setup.prompt }) }
    )
  );
  if (!("ok" in graded)) return { judge: { errorCode: graded.errorCode }, usage: null };
  const { result, usage } = graded.ok;
  return { judge: { scores: result.scores, checks: result.checks }, usage: caseUsageOf(usage) };
}

export interface JudgeSummary {
  judged: number;
  errors: number;
  codePassed: number;
  codeFailedBy: Partial<Record<DraftCheckCode, number>>;
  // The mean of each rubric score over the judged cases that have scores.
  scoreMeans: Record<string, number>;
  passed: number;
  scored: number;
}

// Null when no case has a judge result.
export function summarizeJudge(cases: readonly Pick<CaseResult, "judge">[]): JudgeSummary | null {
  const judged = cases.map((c) => c.judge).filter((judge): judge is NonNullable<CaseJudge> => judge !== null);
  if (judged.length === 0) return null;
  const scored = judged.filter(
    (judge): judge is Extract<NonNullable<CaseJudge>, { scores: unknown }> => "scores" in judge
  );
  const codeFailedBy: Partial<Record<DraftCheckCode, number>> = {};
  const sums: Record<string, number> = {};
  for (const judge of scored) {
    for (const code of judge.codeFailed) codeFailedBy[code] = (codeFailedBy[code] ?? 0) + 1;
    for (const [name, value] of Object.entries(judge.scores)) sums[name] = (sums[name] ?? 0) + value;
  }
  return {
    judged: judged.length,
    errors: judged.length - scored.length,
    codePassed: scored.filter((judge) => judge.codeFailed.length === 0).length,
    codeFailedBy,
    scoreMeans: Object.fromEntries(Object.entries(sums).map(([name, sum]) => [name, sum / scored.length])),
    passed: scored.filter((judge) => judge.passed).length,
    scored: scored.length,
  };
}
