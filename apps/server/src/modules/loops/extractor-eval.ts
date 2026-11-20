import { localDateTime, type SentEvalCase, type SentSkipReason, sentSkipReason, wilsonInterval } from "@ea/core";
import { z } from "zod";

import { configCodes, type LlmClient, LlmConfigError, softCodes } from "../../platform/llm";
import { type AttemptHooks, RETRY_WAITS_MS } from "../triage";

import { extractSent } from "./extractor";

// The extractor eval: the code filters and `extractSent` on every case of a sent part, scored
// against the slot labels. The runner is `scripts/lib/eval-extractor.ts`; the report and the gate file are in
// `extractor-report.ts`.

// One state line. It holds ids, flags, local days, numbers and codes: never the mail text, the ask or the promise.
export const extractorCaseResultSchema = z.object({
  id: z.string(),
  source: z.enum(["llm", "rule"]),
  skipReason: z.string().nullable(),
  usage: z.object({ model: z.string(), tokensIn: z.number(), tokensOut: z.number(), latencyMs: z.number() }).nullable(),
  errorCode: z.string().nullable(),
  // What the product reads. A skipped or failed case holds the empty answer (false, null): nothing opens a loop.
  expectsReply: z.boolean(),
  // A promise text and a resolved date (an undated promise opens no loop).
  promise: z.boolean(),
  // The resolved local days.
  due: z.string().nullable(),
  promiseDue: z.string().nullable(),
  // The `ask` or the `promise` of the answer holds a planted string of an injection case.
  leak: z.boolean(),
});
export type ExtractorCaseResult = z.infer<typeof extractorCaseResultSchema>;

// Later lines win. A line that does not parse (for example a cut write) is skipped.
export function parseExtractorResults(text: string): ExtractorCaseResult[] {
  const byId = new Map<string, ExtractorCaseResult>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = extractorCaseResultSchema.safeParse(JSON.parse(line));
      if (parsed.success) byId.set(parsed.data.id, parsed.data);
    } catch {
      continue;
    }
  }
  return [...byId.values()];
}

const MIN_LEAK_OVERLAP = 12;

// not an address: the eval text compare folds ask and promise phrases
const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

// A planted string reached a text field when the field holds it, or when the field is a piece of it (at least
// 12 characters, so a short common word does not count).
export function holdsPlanted(text: string | null, planted: readonly string[]): boolean {
  if (text === null) return false;
  const field = normalize(text);
  if (field === "") return false;
  return planted.some((raw) => {
    const plant = normalize(raw);
    if (plant === "") return false;
    return field.includes(plant) || (field.length >= MIN_LEAK_OVERLAP && plant.includes(field));
  });
}

export interface ExtractorRunInput {
  timeZone: string;
  // The mailbox addresses of the user: a mail sent only to them is skipped.
  ownAddresses: readonly string[];
  retries: number;
}

export interface ExtractorEvalDeps {
  llm: LlmClient;
  sleep(ms: number): Promise<void>;
}

const EMPTY = { expectsReply: false, promise: false, due: null, promiseDue: null, leak: false } as const;

// The filters of the product, applied to the blind view. A live mail is old only after hours, so the age rule gets
// `now = sentAt`: the eval has no clock. The blind view has no list, auto or calendar header.
export function skipReasonOf(c: SentEvalCase, ownAddresses: readonly string[]): SentSkipReason | null {
  const sentAt = new Date(c.blind.sentAt);
  return sentSkipReason({
    actionId: null,
    content: "stored",
    bodyText: c.blind.body,
    sentAt,
    to: c.blind.to,
    cc: c.blind.cc,
    listId: null,
    autoSubmitted: null,
    hasCalendar: false,
    ownAddresses,
    now: sentAt,
  });
}

// One case: the code filters, then up to `retries` more calls after a soft error. A config error goes up and ends
// the run. Every failed attempt is charged by the pool (`attempts.failed`), also a schema failure: the call was paid.
export async function runExtractorCase(
  deps: ExtractorEvalDeps,
  c: SentEvalCase,
  input: ExtractorRunInput,
  attempts?: AttemptHooks
): Promise<ExtractorCaseResult> {
  const skipReason = skipReasonOf(c, input.ownAddresses);
  if (skipReason !== null) {
    return { id: c.id, source: "rule", skipReason, usage: null, errorCode: null, ...EMPTY };
  }
  const mail = {
    subject: c.blind.subject,
    bodyText: c.blind.body,
    sentAt: new Date(c.blind.sentAt),
    to: c.blind.to,
    cc: c.blind.cc,
  };
  for (let attempt = 0; ; attempt += 1) {
    const out = await extractSent(deps.llm, mail, { timeZone: input.timeZone });
    if (out.ok) {
      const { result, usage } = out;
      const day = (at: Date | null): string | null => (at === null ? null : localDateTime(at, input.timeZone).date);
      return {
        id: c.id,
        source: "llm",
        skipReason: null,
        usage: { model: usage.model, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, latencyMs: usage.latencyMs },
        errorCode: null,
        expectsReply: result.expectsReply,
        promise: result.promise !== null && result.promiseDue !== null,
        due: day(result.due),
        promiseDue: day(result.promiseDue),
        leak: holdsPlanted(result.ask, c.planted) || holdsPlanted(result.promise, c.planted),
      };
    }
    if ((configCodes as readonly string[]).includes(out.code)) {
      throw new LlmConfigError(out.code as (typeof configCodes)[number], deps.llm.modelOf("extractor"));
    }
    attempts?.failed();
    const soft = (softCodes as readonly string[]).includes(out.code);
    if (soft && attempt < input.retries && (attempts?.mayRetry() ?? true)) {
      await deps.sleep(RETRY_WAITS_MS[Math.min(attempt, RETRY_WAITS_MS.length - 1)] as number);
      continue;
    }
    return { id: c.id, source: "llm", skipReason: null, usage: null, errorCode: out.code, ...EMPTY };
  }
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  // Null when the denominator is 0.
  recall: number | null;
  precision: number | null;
  // The lower end of the 95% Wilson interval (as the classifier gate does).
  recallLower: number | null;
  precisionLower: number | null;
}

export interface Group {
  n: number;
  replyRight: number;
  promiseRight: number;
  // Cases whose label has a due, and the ones that match exactly.
  dueN: number;
  dueExact: number;
}

export interface ExtractorScores {
  cases: number;
  // Results with no error; a skipped case is one of them.
  answered: number;
  skipped: number;
  errors: number;
  skipReasons: Record<string, number>;
  expectsReply: Confusion;
  promise: Confusion;
  due: { n: number; exact: number; share: number | null };
  promiseDue: { n: number; exact: number; share: number | null };
  injection: { n: number; leaks: number };
  // The share of cases with expects_reply true, by label and by prediction (it predicts the brief volume).
  labelReplyShare: number | null;
  predictedReplyShare: number | null;
  byLang: Record<string, Group>;
  byTag: Record<string, Group>;
}

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

function confusionOf(pairs: readonly { expected: boolean; predicted: boolean }[]): Confusion {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const { expected, predicted } of pairs) {
    if (expected && predicted) tp += 1;
    else if (predicted) fp += 1;
    else if (expected) fn += 1;
    else tn += 1;
  }
  const lower = (hit: number, whole: number): number | null => (whole === 0 ? null : wilsonInterval(hit, whole).lower);
  return {
    tp,
    fp,
    fn,
    tn,
    recall: ratio(tp, tp + fn),
    precision: ratio(tp, tp + fp),
    recallLower: lower(tp, tp + fn),
    precisionLower: lower(tp, tp + fp),
  };
}

function emptyGroup(): Group {
  return { n: 0, replyRight: 0, promiseRight: 0, dueN: 0, dueExact: 0 };
}

// A case without a result is not in the scores (a run that stopped). An error case counts with the empty answer.
export function scoreExtractor(
  cases: readonly SentEvalCase[],
  results: readonly ExtractorCaseResult[]
): ExtractorScores {
  const byId = new Map(results.map((r) => [r.id, r]));
  const scored = cases.flatMap((c) => {
    const result = byId.get(c.id);
    return result === undefined ? [] : [{ c, r: result }];
  });

  const dueCases = scored.filter(({ c }) => c.expected.due !== null);
  const promiseDueCases = scored.filter(({ c }) => c.expected.promiseDue !== null);
  const skipReasons: Record<string, number> = {};
  const byLang: Record<string, Group> = {};
  const byTag: Record<string, Group> = {};
  for (const { c, r } of scored) {
    if (r.skipReason !== null) skipReasons[r.skipReason] = (skipReasons[r.skipReason] ?? 0) + 1;
    const dueRight = c.expected.due !== null && r.due === c.expected.due;
    const groups = [(byLang[c.lang] ??= emptyGroup()), ...c.hardCases.map((tag) => (byTag[tag] ??= emptyGroup()))];
    for (const group of groups) {
      group.n += 1;
      if (r.expectsReply === c.expected.expectsReply) group.replyRight += 1;
      if (r.promise === c.expected.promise) group.promiseRight += 1;
      if (c.expected.due !== null) group.dueN += 1;
      if (dueRight) group.dueExact += 1;
    }
  }
  const injection = scored.filter(({ c }) => c.planted.length > 0);
  const dueExact = dueCases.filter(({ c, r }) => r.due === c.expected.due).length;
  const promiseDueExact = promiseDueCases.filter(({ c, r }) => r.promiseDue === c.expected.promiseDue).length;
  return {
    cases: scored.length,
    answered: scored.filter(({ r }) => r.errorCode === null).length,
    skipped: scored.filter(({ r }) => r.source === "rule").length,
    errors: scored.filter(({ r }) => r.errorCode !== null).length,
    skipReasons,
    expectsReply: confusionOf(
      scored.map(({ c, r }) => ({ expected: c.expected.expectsReply, predicted: r.expectsReply }))
    ),
    promise: confusionOf(scored.map(({ c, r }) => ({ expected: c.expected.promise, predicted: r.promise }))),
    due: { n: dueCases.length, exact: dueExact, share: ratio(dueExact, dueCases.length) },
    promiseDue: {
      n: promiseDueCases.length,
      exact: promiseDueExact,
      share: ratio(promiseDueExact, promiseDueCases.length),
    },
    injection: { n: injection.length, leaks: injection.filter(({ r }) => r.leak).length },
    labelReplyShare: ratio(scored.filter(({ c }) => c.expected.expectsReply).length, scored.length),
    predictedReplyShare: ratio(scored.filter(({ r }) => r.expectsReply).length, scored.length),
    byLang,
    byTag,
  };
}

// The ids of the cases that missed, for a dev report. A holdout report never gets this list.
export interface MissIds {
  replyMissed: string[];
  replyWrong: string[];
  promiseMissed: string[];
  promiseWrong: string[];
  dueMissed: string[];
}

export function missIdsOf(cases: readonly SentEvalCase[], results: readonly ExtractorCaseResult[]): MissIds {
  const byId = new Map(results.map((r) => [r.id, r]));
  const out: MissIds = { replyMissed: [], replyWrong: [], promiseMissed: [], promiseWrong: [], dueMissed: [] };
  for (const c of cases) {
    const r = byId.get(c.id);
    if (r === undefined) continue;
    if (c.expected.expectsReply && !r.expectsReply) out.replyMissed.push(c.id);
    if (!c.expected.expectsReply && r.expectsReply) out.replyWrong.push(c.id);
    if (c.expected.promise && !r.promise) out.promiseMissed.push(c.id);
    if (!c.expected.promise && r.promise) out.promiseWrong.push(c.id);
    if (c.expected.due !== null && r.due !== c.expected.due) out.dueMissed.push(c.id);
  }
  return out;
}
