// The history check job: one check per organization per run moves through `queued` → `backfilling` → `waiting_flags` →
// `classifying` → `done`. Steps are idempotent (mail dedup, one item per mail), a claim holds a lock, and a step error costs one
// attempt. Only the classify step calls the model (`history-classify.ts`); a run stops starting organizations after its time budget.
// Logs carry the check id, the mailbox id, a status and a code: never a mail value, an address or a token.
import { DAY_MS, type EvidenceKey, type GateIndex, MINUTE_MS } from "@ea/core";

import type { SecretBox } from "../../platform/crypto";
import type { Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import type { LlmClient } from "../../platform/llm";
import { createLog } from "../../platform/log";
import {
  backfillMailbox,
  countInboxMailWithoutFreshFlags,
  CursorMovedError,
  getMailbox,
  listSyncTargets,
  MailAuthError,
  refreshFlagsOfMailbox,
  type BackfillDeps,
  type BackfillRefusal,
  type ImapConnectOptions,
  type MailProvider,
  type OAuthTokens,
  type TestMailRule,
} from "../mail";
import { isFeatureOn, isOrgSuspended, listOrganizations } from "../tenancy";
import type { ClassifierPromptChoice, LlmPause, TriageScope } from "../triage";

import { classifyStep, HISTORY_RUN_MS } from "./history-classify";
import { reportNoticeOnEnd } from "./history-ended";
import {
  claimNextCheck,
  endCheck,
  endCheckKeyChanged,
  failStep,
  listMailboxesWithoutCheck,
  listOrgsWithDueChecks,
  markBackfilled,
  markStatus,
  queueFlagOnCheck,
  releaseCheck,
  HISTORY_RETRY_MS,
  HISTORY_WINDOW_DAYS,
  type ClaimedCheck,
  type EndedHook,
} from "./history-queue";
import type { NoResultReason } from "./repo";

const log = createLog("trust");

/** The classify step starts at the latest this long after the backfill, also when some flags are still unknown. */
export const HISTORY_FLAGS_WAIT_MS = 20 * MINUTE_MS;
/** After this many moved-cursor retries of one check the next one counts one attempt, so a check cannot stay open for ever. */
export const HISTORY_CURSOR_RETRIES = 20;
/** A wait for the flags, and a retry after a moved cursor, run again after this. */
export const HISTORY_FLAGS_POLL_MS = MINUTE_MS;

export interface HistoryJobDeps {
  db: Db;
  secrets: SecretBox;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
  /** The access tokens of OAuth mailboxes: without them an OAuth mailbox cannot be read. */
  oauthTokens?: OAuthTokens;
  isOwnActionId: BackfillDeps["isOwnActionId"];
  /** The evidence key of the running classifier; stored on the check when its backfill ends. */
  runningKey: EvidenceKey;
  /** The gate files of the image: the notice of the first check names the categories that they recommend. */
  gateIndex: GateIndex;
  /** The model client of the triage worker, its pause and its scope (`TRIAGE_LLM_SCOPE`): the history job follows them. */
  llm: LlmClient;
  pause: LlmPause;
  scope: TriageScope;
  testMail: TestMailRule;
  trustedAuthservIds?: readonly string[];
  /** Absent: the production prompt. */
  prompt?: ClassifierPromptChoice;
  /** `WEB_BASE_URL`: the report link of the first notice. */
  webBaseUrl?: string;
  now(): Date;
  /** Test seams: a hook that throws simulates a crash at that point. */
  hooks?: {
    afterBackfill?: () => void | Promise<void>;
    afterCall?: () => void | Promise<void>;
    /** Replaces the hook that runs when a check ends (the report notice). */
    onEnded?: EndedHook;
  };
}

// What the checks before a step decided.
type Gate =
  | { kind: "go" }
  | { kind: "wait"; reason: string }
  | { kind: "end"; reason: NoResultReason }
  | { kind: "gone" };

// How one step ended; the job writes the matching row.
type StepEnd =
  | { kind: "advance"; at: Date; status: "waiting_flags" | "classifying" }
  | { kind: "wait"; at: Date; reason: string }
  | { kind: "end"; reason: NoResultReason; quiet?: true }
  // The running key is not the key of the check: the check ends and a `model_switch` check starts.
  | { kind: "key_changed" }
  // The step wrote its own rows, the lock is already released or lost.
  | { kind: "done" };

const after = (now: Date, ms: number): Date => new Date(now.getTime() + ms);

// The checks that need no mail: the organization, the flag, the mailbox state. An operator check (`cli`) ignores the flag.
async function gateOf(deps: HistoryJobDeps, ctx: TenantContext, check: ClaimedCheck): Promise<Gate> {
  if (await isOrgSuspended(deps.db, ctx)) return { kind: "wait", reason: "org_suspended" };
  if (check.reason !== "cli" && !(await isFeatureOn(deps.db, ctx, "trust_ladder"))) {
    return { kind: "wait", reason: "flag_off" };
  }
  const mailbox = await getMailbox(deps.db, ctx, check.mailboxId);
  if (mailbox === undefined) return { kind: "gone" };
  // A user pause and a blocked host stop the read: they end by themselves, so the check waits. A refused login does not end
  // by itself: the check ends as `auth_refused` (the reasons of `history_checks` hold no state of the mailbox).
  if (mailbox.status === "paused") return { kind: "wait", reason: "mailbox_paused" };
  if (mailbox.status === "host_blocked") return { kind: "wait", reason: "host_blocked" };
  if (mailbox.status === "auth_error") return { kind: "end", reason: "auth_refused" };
  return { kind: "go" };
}

function endOfRefusal(refusal: BackfillRefusal, now: Date): StepEnd {
  switch (refusal) {
    case "never_synced":
    case "org_suspended":
      // The first sync comes within minutes; a suspended organization resumes. No attempt for either.
      return { kind: "wait", at: after(now, HISTORY_RETRY_MS), reason: refusal };
    case "uidvalidity_changed":
      return { kind: "end", reason: "uidvalidity" };
    case "auth_refused":
      return { kind: "end", reason: "auth_refused" };
    case "window_too_long":
      // 30 days never reach the limit: a bug, so the step fails and counts an attempt.
      throw new Error("history window is longer than the backfill limit");
  }
}

async function backfillStep(deps: HistoryJobDeps, ctx: TenantContext, check: ClaimedCheck): Promise<StepEnd> {
  if (!(await markStatus(deps.db, ctx, check, "backfilling"))) return { kind: "done" };
  // The window is the window of this read: the backfill reads the last 30 days from `readAt` and so does the flag refresh.
  const readAt = deps.now();
  const outcome = await backfillMailbox(
    {
      db: deps.db,
      secrets: deps.secrets,
      openProvider: deps.openProvider,
      isOwnActionId: deps.isOwnActionId,
      ...(deps.oauthTokens === undefined ? {} : { oauthTokens: deps.oauthTokens }),
    },
    ctx,
    check.mailboxId,
    { days: HISTORY_WINDOW_DAYS, now: readAt, purpose: "history" }
  );
  if (outcome.kind === "refused") return endOfRefusal(outcome.reason, deps.now());
  if (outcome.result.fetched === 0) return { kind: "end", reason: "no_history" };
  await deps.hooks?.afterBackfill?.();
  const doneAt = deps.now();
  if (
    !(await markBackfilled(deps.db, ctx, check, {
      at: doneAt,
      windowStart: new Date(readAt.getTime() - HISTORY_WINDOW_DAYS * DAY_MS),
      key: deps.runningKey,
    }))
  )
    return { kind: "done" };
  // The flags of the history mail do not wait for the sync cadence of 10 minutes. A fault here is not a fault of the step: the wait
  // step has its own time limit. A refused login ends the check.
  try {
    await refreshFlagsOfMailbox(
      {
        db: deps.db,
        secrets: deps.secrets,
        openProvider: deps.openProvider,
        isOwnActionId: deps.isOwnActionId,
        ...(deps.oauthTokens === undefined ? {} : { oauthTokens: deps.oauthTokens }),
      },
      ctx,
      check.mailboxId,
      deps.now
    );
  } catch (error) {
    if (error instanceof MailAuthError) return { kind: "end", reason: "auth_refused" };
    log
      .with({ org_id: ctx.orgId, mailbox_id: check.mailboxId, check_id: check.id })
      .warn("history_flags_refresh_failed", {
        ...errorFields(error),
      });
  }
  return { kind: "advance", at: deps.now(), status: "waiting_flags" };
}

async function flagsStep(deps: HistoryJobDeps, ctx: TenantContext, check: ClaimedCheck): Promise<StepEnd> {
  const doneAt = check.backfillDoneAt;
  const windowStart = check.windowStart;
  if (doneAt === null || windowStart === null) throw new Error("check waits for flags without a backfill window");
  const now = deps.now();
  // After the limit the mail without a fresh flag row counts as not acted on.
  if (now.getTime() >= doneAt.getTime() + HISTORY_FLAGS_WAIT_MS)
    return { kind: "advance", at: now, status: "classifying" };
  const unknown = await countInboxMailWithoutFreshFlags(deps.db, ctx, check.mailboxId, {
    since: windowStart,
    checkedSince: doneAt,
    receivedBefore: doneAt,
  });
  if (unknown === 0) return { kind: "advance", at: now, status: "classifying" };
  return { kind: "wait", at: after(now, HISTORY_FLAGS_POLL_MS), reason: "flags_unknown" };
}

async function classifyStepOf(
  deps: HistoryJobDeps,
  ctx: TenantContext,
  check: ClaimedCheck,
  checkLog: ReturnType<typeof log.with>,
  deadline: Date,
  failures: Map<string, number>
): Promise<StepEnd> {
  const end = await classifyStep(
    {
      db: deps.db,
      llm: deps.llm,
      pause: deps.pause,
      scope: deps.scope,
      testMail: deps.testMail,
      runningKey: deps.runningKey,
      ...(deps.trustedAuthservIds === undefined ? {} : { trustedAuthservIds: deps.trustedAuthservIds }),
      ...(deps.prompt === undefined ? {} : { prompt: deps.prompt }),
      now: deps.now,
      onEnded: endedHookOf(deps),
      failures,
      ...(deps.hooks?.afterCall === undefined ? {} : { hooks: { afterCall: deps.hooks.afterCall } }),
    },
    ctx,
    check,
    checkLog,
    deadline
  );
  return end.kind === "advance" ? { kind: "advance", at: end.at, status: "classifying" } : end;
}

const endedHookOf = (deps: HistoryJobDeps): EndedHook =>
  deps.hooks?.onEnded ??
  reportNoticeOnEnd({
    gate: { index: deps.gateIndex, runningKey: deps.runningKey },
    testMail: deps.testMail,
    ...(deps.webBaseUrl === undefined ? {} : { webBaseUrl: deps.webBaseUrl }),
    now: deps.now,
  });

async function runStep(
  deps: HistoryJobDeps,
  ctx: TenantContext,
  check: ClaimedCheck,
  checkLog: ReturnType<typeof log.with>,
  deadline: Date,
  failures: Map<string, number>
): Promise<StepEnd> {
  if (check.status === "classifying") return classifyStepOf(deps, ctx, check, checkLog, deadline, failures);
  if (check.status === "waiting_flags") return flagsStep(deps, ctx, check);
  return backfillStep(deps, ctx, check);
}

async function processCheck(
  deps: HistoryJobDeps,
  ctx: TenantContext,
  check: ClaimedCheck,
  cursorRetries: Map<string, number>,
  deadline: Date,
  failures: Map<string, number>
): Promise<void> {
  const checkLog = log.with({ org_id: ctx.orgId, mailbox_id: check.mailboxId, check_id: check.id });
  const now = deps.now();
  try {
    const gate = await gateOf(deps, ctx, check);
    if (gate.kind === "gone") return;
    let end: StepEnd;
    if (gate.kind === "go") end = await runStep(deps, ctx, check, checkLog, deadline, failures);
    else if (gate.kind === "wait") end = { kind: "wait", at: after(now, HISTORY_RETRY_MS), reason: gate.reason };
    else end = { kind: "end", reason: gate.reason };
    await finish(deps, ctx, check, end, checkLog);
    cursorRetries.delete(check.id);
  } catch (error) {
    if (error instanceof CursorMovedError) {
      // A regular sync moved the cursor between the plan and the apply of one chunk: nothing of it is stored and the repeat is cheap.
      // A retry that costs no attempt, until the 20th: that one counts as a failed step. The count lives in this process; a restart
      // starts it again, and the three attempts still end the check.
      const retries = (cursorRetries.get(check.id) ?? 0) + 1;
      if (retries < HISTORY_CURSOR_RETRIES) {
        cursorRetries.set(check.id, retries);
        checkLog.info("history_step_retry", { reason: "cursor_moved", count: retries });
        await releaseCheck(deps.db, ctx, check, { at: after(deps.now(), HISTORY_FLAGS_POLL_MS) });
        return;
      }
      cursorRetries.delete(check.id);
    }
    const failed = await failStep(deps.db, ctx, check, deps.now(), endedHookOf(deps));
    checkLog.warn("history_step_failed", {
      ...errorFields(error),
      status: check.status,
      ...(failed === null ? { reason: "lock_lost" } : { attempts: failed.attempts }),
    });
    if (failed?.stopped === true) checkLog.warn("history_check_ended", { status: "no_result", reason: "stopped" });
  }
}

async function finish(
  deps: HistoryJobDeps,
  ctx: TenantContext,
  check: ClaimedCheck,
  end: StepEnd,
  checkLog: ReturnType<typeof log.with>
): Promise<void> {
  if (end.kind === "done") return;
  const now = deps.now();
  if (end.kind === "end") {
    if (await endCheck(deps.db, ctx, check, end.reason, now, end.quiet === true ? undefined : endedHookOf(deps))) {
      checkLog.info("history_check_ended", { status: "no_result", reason: end.reason });
    }
    return;
  }
  if (end.kind === "key_changed") {
    if (await endCheckKeyChanged(deps.db, ctx, check, now)) {
      checkLog.info("history_check_ended", { status: "no_result", reason: "key_changed" });
    }
    return;
  }
  if (end.kind === "wait") {
    if (await releaseCheck(deps.db, ctx, check, { at: end.at }))
      checkLog.info("history_step_waiting", { reason: end.reason });
    return;
  }
  if (await releaseCheck(deps.db, ctx, check, { at: end.at, status: end.status })) {
    checkLog.info("history_step_done", { status: end.status });
  }
}

// A flag-on organization starts the check of every active mailbox that has none: turning the flag on for
// mailboxes that exist already starts their checks. The unique index and the mailbox lock make it one row.
async function queueFlagOnChecks(deps: HistoryJobDeps): Promise<void> {
  const targets = await listSyncTargets(deps.db);
  if (targets.length === 0) return;
  const byOrg = new Map<string, string[]>();
  for (const { orgId, mailboxId } of targets) byOrg.set(orgId, [...(byOrg.get(orgId) ?? []), mailboxId]);
  for (const org of await listOrganizations(deps.db)) {
    const mailboxIds = byOrg.get(org.id);
    if (mailboxIds === undefined) continue;
    const ctx = { orgId: org.id };
    try {
      if (!(await isFeatureOn(deps.db, ctx, "trust_ladder"))) continue;
      for (const mailboxId of await listMailboxesWithoutCheck(deps.db, ctx, mailboxIds)) {
        if (await queueFlagOnCheck(deps.db, ctx, mailboxId)) {
          log.with({ org_id: org.id, mailbox_id: mailboxId }).info("history_check_queued", { reason: "flag_on" });
        }
      }
    } catch (error) {
      log.with({ org_id: org.id }).warn("history_flag_on_failed", { ...errorFields(error) });
    }
  }
}

export function createHistoryJob(deps: HistoryJobDeps): { run(): Promise<void> } {
  // Moved-cursor retries per check in this process.
  const cursorRetries = new Map<string, number>();
  // Failed model calls in a row per check in this process (a restart starts the count again; the cost cap still holds).
  const failures = new Map<string, number>();
  return {
    async run() {
      try {
        await queueFlagOnChecks(deps);
      } catch (error) {
        log.warn("history_flag_on_failed", { ...errorFields(error) });
      }
      // The time budget of one run: a long backfill or a slow model of one organization must not hold up the others for many runs. No new
      // organization starts after it; the organizations are listed longest-waiting first, so the next run starts with the ones left out.
      const startedAt = deps.now();
      const deadline = new Date(startedAt.getTime() + HISTORY_RUN_MS);
      for (const orgId of await listOrgsWithDueChecks(deps.db, startedAt)) {
        if (deps.now().getTime() >= deadline.getTime()) break;
        const ctx = { orgId };
        try {
          const claim = await claimNextCheck(deps.db, ctx, deps.now(), endedHookOf(deps));
          if (claim.kind === "claimed") await processCheck(deps, ctx, claim.check, cursorRetries, deadline, failures);
          else if (claim.kind === "stopped") {
            log
              .with({ org_id: orgId, mailbox_id: claim.mailboxId, check_id: claim.checkId })
              .warn("history_check_ended", { status: "no_result", reason: "stopped" });
          }
        } catch (error) {
          log.with({ org_id: orgId }).error("history_run_failed", { ...errorFields(error) });
        }
      }
    },
  };
}
