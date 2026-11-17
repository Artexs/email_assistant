// The classify step of the history check (F110 D10 to D13): one item per sample mail, each with its own cost, then the result.
// A run classifies up to 20 mails one after another and stops after 12 seconds; the job runs again 15 seconds later.
// Money rules: the check stops at $0.25 (`capped`), a model without a price never runs (`cost_unknown`), a pause of the model client
// waits (no attempt), and a repeat after a crash repeats at most the one call that had no committed item.
// Logs carry the check id, codes and counts: never a mail value, an address or a token.
import { costPerMail, evidenceKeySchema, sameKey, type EvidenceKey } from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { errorFields, SoftError } from "../../platform/errors";
import { LlmBlockedError, LlmConfigError, llmErrorCode, type LlmClient } from "../../platform/llm";
import type { Log } from "../../platform/log";
import { recordLlmCall } from "../audit";
import { countAnswered, listFromAddresses, listHistoryCandidates, type TestMailRule } from "../mail";
import {
  classifyStored,
  listNewestResultsOf,
  loadTriageMailbox,
  wouldMoveOf,
  type ClassifierPromptChoice,
  type LlmPause,
  type StoredClassification,
  type StoredResultRow,
  type TriageMailbox,
  type TriageScope,
} from "../triage";

import { historyActedOn } from "./acted-on";
import { listItemEmailIds, listItems, LockLostError, recordItem, type NewItem } from "./history-items";
import { completeCheck, type ClaimedCheck, type EndedHook } from "./history-queue";
import { historyResultOf } from "./history-result";
import type { NoResultReason } from "./repo";

/** The sample of one check: at most this many mails. */
export const HISTORY_SAMPLE_SIZE = 500;
/** Mails per run. */
export const HISTORY_RUN_MAILS = 20;
/** A run starts no new mail after this long (the job runs every 15 seconds). */
export const HISTORY_RUN_MS = 12_000;
/** The spend of one check: before a call at or over this, the check stops and evaluates what it has. */
export const HISTORY_COST_CAP_USD = 0.25;

export interface ClassifyDeps {
  db: Db;
  llm: LlmClient;
  /** The pause of the model client, shared with the triage worker. */
  pause: LlmPause;
  scope: TriageScope;
  testMail: TestMailRule;
  runningKey: EvidenceKey;
  trustedAuthservIds?: readonly string[];
  /** Absent: the production prompt. */
  prompt?: ClassifierPromptChoice;
  now(): Date;
  /** The end of a check queues the report notice in its transaction. */
  onEnded: EndedHook;
  /** Test seams: a hook that throws simulates a crash after the call and before the item commits. */
  hooks?: { afterCall?: () => void | Promise<void> };
}

/** How the step ended; the job writes the matching row (or the step wrote it already: `done`). */
export type ClassifyEnd =
  | { kind: "advance"; at: Date }
  | { kind: "wait"; at: Date; reason: string }
  | { kind: "end"; reason: NoResultReason }
  | { kind: "key_changed" }
  | { kind: "done" };

/** Acted-on mail first, newest first; then the rest in the seeded order of the check; cut to the sample size. */
export function orderSample(candidates: readonly { id: string; hash: string }[], acted: ReadonlySet<string>): string[] {
  const first = candidates.filter((candidate) => acted.has(candidate.id));
  const fill = candidates
    .filter((candidate) => !acted.has(candidate.id))
    .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...first, ...fill].slice(0, HISTORY_SAMPLE_SIZE).map((candidate) => candidate.id);
}

// A stored triage result that counts for this check: a rule result always, a model result only under the key of the check and
// never for a check that a model switch started (its mail must be judged by the new model).
function reusable(
  stored: StoredResultRow | undefined,
  key: EvidenceKey,
  check: ClaimedCheck
): "rule" | "triage_result" | null {
  if (stored === undefined) return null;
  if (stored.model === null && stored.reasonCode === "blocklist") return "rule";
  if (check.reason === "model_switch") return null;
  return stored.model === key.model && stored.promptVersion === key.promptVersion ? "triage_result" : null;
}

function itemOfStored(
  emailId: string,
  stored: StoredResultRow,
  source: "rule" | "triage_result",
  actedOn: boolean
): NewItem {
  return {
    emailId,
    category: stored.category,
    confidence: stored.confidence,
    reasonCode: stored.reasonCode,
    wouldMove: wouldMoveOf(stored.category, { vip: stored.vip }),
    actedOn,
    source,
    costUsd: 0,
  };
}

function itemOfClassified(emailId: string, result: StoredClassification, actedOn: boolean, costUsd: number): NewItem {
  return {
    emailId,
    category: result.category,
    confidence: result.confidence,
    reasonCode: result.reasonCode,
    wouldMove: result.wouldMove,
    actedOn,
    source: result.source,
    costUsd,
  };
}

// A mail that the model could not judge (a blocked or invalid answer): an `unsure` item, not acted on, so it neither counts in the
// moved share nor is asked again. Without it the same mail would cost a call in every run.
function itemOfFailure(emailId: string, error: unknown): NewItem {
  return {
    emailId,
    category: "unsure",
    confidence: 0,
    reasonCode: error instanceof LlmBlockedError ? "llm_blocked" : "classify_error",
    wouldMove: false,
    actedOn: false,
    source: "classified",
    costUsd: 0,
  };
}

/** The sample mail without an item, in order. */
async function pendingSample(
  deps: ClassifyDeps,
  ctx: TenantContext,
  check: ClaimedCheck,
  windowStart: Date
): Promise<{ pending: string[]; acted: ReadonlySet<string>; itemCount: number }> {
  const candidates = await listHistoryCandidates(deps.db, ctx, check.mailboxId, {
    since: windowStart,
    checkId: check.id,
    scope: deps.scope.kind === "synthetic" ? { testMail: deps.scope.testMail } : false,
  });
  const acted = await historyActedOn(
    deps.db,
    ctx,
    candidates.map((candidate) => candidate.id)
  );
  const done = await listItemEmailIds(deps.db, ctx, check.id);
  const sample = orderSample(candidates, acted);
  return { pending: sample.filter((id) => !done.has(id)), acted, itemCount: done.size };
}

async function finalize(
  deps: ClassifyDeps,
  ctx: TenantContext,
  check: ClaimedCheck,
  capped: boolean,
  checkLog: Log
): Promise<ClassifyEnd> {
  const items = await listItems(deps.db, ctx, check.id);
  const result = historyResultOf(items);
  const completed = await completeCheck(deps.db, ctx, check, { result, capped, now: deps.now() }, deps.onEnded);
  if (!completed) return { kind: "done" };
  const answered = await countAnswered(
    deps.db,
    ctx,
    items.map((item) => item.emailId)
  );
  // N2: the share of `\Answered` among the mail of the check shows whether the provider sets the flag at all.
  checkLog.info("history_check_result", {
    checked: items.length,
    acted: items.filter((item) => item.actedOn).length,
    answered_pct: items.length === 0 ? 0 : Math.round((answered / items.length) * 100),
    capped,
    info_outcome: result.info.outcome,
    info_moved: result.info.moved,
    notification_outcome: result.notification.outcome,
    notification_moved: result.notification.moved,
    spam_outcome: result.spam.outcome,
    spam_moved: result.spam.moved,
  });
  return { kind: "done" };
}

export async function classifyStep(
  deps: ClassifyDeps,
  ctx: TenantContext,
  check: ClaimedCheck,
  checkLog: Log,
  deadline: Date
): Promise<ClassifyEnd> {
  const parsed = evidenceKeySchema.safeParse(check.key);
  // A check with no stored key, or one for another setup, would store the evidence of one setup under another.
  if (!parsed.success || !sameKey(parsed.data, deps.runningKey)) return { kind: "key_changed" };
  const key: EvidenceKey = parsed.data;
  const start = deps.now();
  if (costPerMail(key.model, 0, 0, start, key.endpoint) === null) return { kind: "end", reason: "cost_unknown" };
  const pausedUntil = deps.pause.pausedUntil(start);
  if (pausedUntil !== null) return { kind: "wait", at: pausedUntil, reason: "llm_paused" };
  const windowStart = check.windowStart;
  if (windowStart === null) throw new Error("check classifies without a backfill window");

  const { pending, acted, itemCount } = await pendingSample(deps, ctx, check, windowStart);
  if (pending.length === 0 || itemCount >= HISTORY_SAMPLE_SIZE) return finalize(deps, ctx, check, false, checkLog);

  const batch = pending.slice(0, HISTORY_RUN_MAILS);
  const stored = await listNewestResultsOf(deps.db, ctx, batch);
  let mailbox: TriageMailbox | undefined;
  let cost = check.costUsd;
  let handled = 0;
  // Commits one item with its cost. False: the lock of the claim is lost, the step stops and writes nothing more.
  const commit = async (item: NewItem): Promise<boolean> => {
    try {
      const total = await recordItem(deps.db, ctx, check, item);
      if (total !== null) cost = total;
      handled += 1;
      return true;
    } catch (error) {
      if (error instanceof LockLostError) return false;
      throw error;
    }
  };
  for (const emailId of batch) {
    // The first mail always runs: a step that starts late in the run still makes progress.
    if (handled > 0 && deps.now().getTime() >= deadline.getTime()) break;
    const actedOn = acted.has(emailId);
    const known = stored.get(emailId);
    const reuse = reusable(known, key, check);
    if (reuse !== null && known !== undefined) {
      if (!(await commit(itemOfStored(emailId, known, reuse, actedOn)))) return { kind: "done" };
      continue;
    }
    // The cap holds the calls: a mail that needs none is still judged.
    if (cost >= HISTORY_COST_CAP_USD) return finalize(deps, ctx, check, true, checkLog);
    if (mailbox === undefined) {
      const snapshot = await loadTriageMailbox(deps.db, ctx, {
        mailboxId: check.mailboxId,
        runningKey: deps.runningKey,
        ...(deps.trustedAuthservIds === undefined ? {} : { trustedAuthservIds: deps.trustedAuthservIds }),
        senders: await listFromAddresses(deps.db, ctx, batch),
        now: start,
      });
      if (snapshot.kind === "missing") throw new Error(`history check has no ${snapshot.what}`);
      mailbox = snapshot.mailbox;
    }
    let result: StoredClassification;
    try {
      result = await classifyStored(
        {
          db: deps.db,
          llm: deps.llm,
          testMail: deps.testMail,
          ...(deps.prompt === undefined ? {} : { prompt: deps.prompt }),
          mailbox,
          now: deps.now,
          onCall: (call) =>
            recordLlmCall(deps.db, ctx, { ...call, emailId, mailboxId: check.mailboxId, historyCheckId: check.id }),
        },
        ctx,
        emailId
      );
    } catch (error) {
      // The quota and the config are per project: the pause covers all mailboxes and the check waits for its end, with no attempt.
      if (error instanceof SoftError || error instanceof LlmConfigError) {
        const until = deps.pause.trip(error instanceof SoftError ? "soft" : "config", llmErrorCode(error), deps.now());
        return { kind: "wait", at: until, reason: "llm_paused" };
      }
      checkLog.warn("history_mail_failed", { ...errorFields(error) });
      if (!(await commit(itemOfFailure(emailId, error)))) return { kind: "done" };
      continue;
    }
    deps.pause.reset();
    let callCost = 0;
    if (result.usage !== null) {
      const priced = costPerMail(
        result.usage.model,
        result.usage.tokensIn,
        result.usage.tokensOut,
        deps.now(),
        result.usage.endpoint
      );
      // The model that answered has no price: its call cannot be counted, so no more calls run.
      if (priced === null) return { kind: "end", reason: "cost_unknown" };
      callCost = priced;
    }
    await deps.hooks?.afterCall?.();
    if (!(await commit(itemOfClassified(emailId, result, actedOn, callCost)))) return { kind: "done" };
  }
  if (handled === pending.length) return finalize(deps, ctx, check, false, checkLog);
  return { kind: "advance", at: deps.now() };
}
