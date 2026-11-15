// The history check job (F110 D13): one check per organization per run moves through `queued` → `backfilling` → `waiting_flags` →
// `classifying`. The classify step and the result are a later stage; this job leaves a `classifying` check alone.
// Steps are idempotent (mail dedup), a claim holds a lock, and a step error costs one attempt. The job makes no model call.
// Logs carry the check id, the mailbox id, a status and a code: never a mail value, an address or a token.
import type { EvidenceKey } from "@ea/core";

import type { SecretBox } from "../../platform/crypto";
import type { Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
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
} from "../mail";
import { isFeatureOn, isOrgSuspended, listOrganizations } from "../tenancy";

import {
  claimNextCheck,
  endCheck,
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
} from "./history-queue";
import type { NoResultReason } from "./repo";

const log = createLog("trust");

/** The classify step starts at the latest this long after the backfill, also when some flags are still unknown. */
export const HISTORY_FLAGS_WAIT_MS = 20 * 60_000;
/** A wait for the flags, and a retry after a moved cursor, run again after this. */
export const HISTORY_FLAGS_POLL_MS = 60_000;

export interface HistoryJobDeps {
  db: Db;
  secrets: SecretBox;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
  /** The access tokens of OAuth mailboxes: without them an OAuth mailbox cannot be read. */
  oauthTokens?: OAuthTokens;
  isOwnActionId: BackfillDeps["isOwnActionId"];
  /** The evidence key of the running classifier; stored on the check when its backfill ends. */
  runningKey: EvidenceKey;
  now(): Date;
  /** Test seams: a hook that throws simulates a crash at that point. */
  hooks?: { afterBackfill?: () => void | Promise<void> };
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
  | { kind: "end"; reason: NoResultReason }
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
    { days: HISTORY_WINDOW_DAYS, now: deps.now(), purpose: "history" }
  );
  if (outcome.kind === "refused") return endOfRefusal(outcome.reason, deps.now());
  if (outcome.result.fetched === 0) return { kind: "end", reason: "no_history" };
  await deps.hooks?.afterBackfill?.();
  const doneAt = deps.now();
  if (!(await markBackfilled(deps.db, ctx, check, doneAt, deps.runningKey))) return { kind: "done" };
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
  if (doneAt === null) throw new Error("check waits for flags without a backfill time");
  const now = deps.now();
  // After the limit the mail without a fresh flag row counts as not acted on.
  if (now.getTime() >= doneAt.getTime() + HISTORY_FLAGS_WAIT_MS)
    return { kind: "advance", at: now, status: "classifying" };
  const unknown = await countInboxMailWithoutFreshFlags(deps.db, ctx, check.mailboxId, {
    since: check.windowStart,
    checkedSince: doneAt,
  });
  if (unknown === 0) return { kind: "advance", at: now, status: "classifying" };
  return { kind: "wait", at: after(now, HISTORY_FLAGS_POLL_MS), reason: "flags_unknown" };
}

async function runStep(deps: HistoryJobDeps, ctx: TenantContext, check: ClaimedCheck): Promise<StepEnd> {
  if (check.status === "waiting_flags") return flagsStep(deps, ctx, check);
  return backfillStep(deps, ctx, check);
}

async function processCheck(deps: HistoryJobDeps, ctx: TenantContext, check: ClaimedCheck): Promise<void> {
  const checkLog = log.with({ org_id: ctx.orgId, mailbox_id: check.mailboxId, check_id: check.id });
  const now = deps.now();
  try {
    const gate = await gateOf(deps, ctx, check);
    if (gate.kind === "gone") return;
    let end: StepEnd;
    if (gate.kind === "go") end = await runStep(deps, ctx, check);
    else if (gate.kind === "wait") end = { kind: "wait", at: after(now, HISTORY_RETRY_MS), reason: gate.reason };
    else end = { kind: "end", reason: gate.reason };
    await finish(deps, ctx, check, end, checkLog);
  } catch (error) {
    if (error instanceof CursorMovedError) {
      // A regular sync moved the cursor between the plan and the apply of one chunk: nothing of it is stored and the repeat is cheap.
      // A retry that costs no attempt.
      checkLog.info("history_step_retry", { reason: "cursor_moved" });
      await releaseCheck(deps.db, ctx, check, { at: after(deps.now(), HISTORY_FLAGS_POLL_MS) });
      return;
    }
    const failed = await failStep(deps.db, ctx, check, deps.now());
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
    if (await endCheck(deps.db, ctx, check, end.reason, now)) {
      checkLog.info("history_check_ended", { status: "no_result", reason: end.reason });
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

// A flag-on organization starts the check of every active mailbox that has none (review 1 N3): turning the flag on for
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
  return {
    async run() {
      try {
        await queueFlagOnChecks(deps);
      } catch (error) {
        log.warn("history_flag_on_failed", { ...errorFields(error) });
      }
      for (const orgId of await listOrgsWithDueChecks(deps.db, deps.now())) {
        const ctx = { orgId };
        try {
          const claim = await claimNextCheck(deps.db, ctx, deps.now());
          if (claim.kind === "claimed") await processCheck(deps, ctx, claim.check);
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
