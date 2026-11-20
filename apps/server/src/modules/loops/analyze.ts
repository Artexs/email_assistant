import { MINUTE_MS, nextQuotaDayStart, QUOTA_TIMEZONE, quotaDayStart } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { configCodes, type LlmClient, type LlmUsage, softCodes } from "../../platform/llm";
import { createLog } from "../../platform/log";
import { countLlmCallsSince, recordLlmCall } from "../audit";
import { getMailboxSettings } from "../config";
import { contactWaitFor } from "../contacts";
import { listDelegates } from "../delegation";
import { getSentSyncState, listMailboxes, type TestMailRule } from "../mail";
import { isFeatureOn, getOrganization } from "../tenancy";
import { prompts, type LlmPause } from "../triage";

import { listSentCandidates, type SentCandidate, writeAnalysis } from "./analysis-repo";
import { applyRules, inTransaction, lockSentTracking, type MailboxEnv } from "./analyze-rules";
import { writeExtraction } from "./analyze-write";
import { extractSent } from "./extractor";
import { FOLLOW_UP_MIN_WAIT_DAYS } from "./hooks";
import type { DbOrTrx } from "./repo";

const log = createLog("loops");

// The model call of a mailbox stops at this share of the daily cap of the mailbox, so triage keeps the rest.
const CAP_SHARE_NUM = 4;
const CAP_SHARE_DEN = 5;
const CAP_RETRY_AFTER_DAY_MS = 5 * MINUTE_MS;
const RETRY_STEP_MS = 5 * MINUTE_MS;
// The tries of one mail: a schema failure or a hard error counts one; the third ends it.
export const MAX_ATTEMPTS = 3;
export const DEFAULT_LIMIT = 20;

// `synthetic`: only test mail goes to the model. `all`: every mail.
export type AnalysisScope = { kind: "synthetic"; testMail: TestMailRule } | { kind: "all" };

export interface AnalyzeDeps {
  db: DbOrTrx;
  llm: LlmClient;
  // `LLM_DAILY_CAP`: the calls of a mailbox in one quota day, all roles together.
  dailyCap: number;
  scope: AnalysisScope;
  // `CREDENTIALS_KEY`: the key of the contact hash, for the usual reply time of a contact (`contactWaitFor`).
  credentialsKey: string;
  // The pause of this job. A soft error or a configuration error of the model stops all mailboxes for a while.
  pause: LlmPause;
}

export interface AnalyzeResult {
  // Rows that got an analysis row (any status but `pending`).
  analysed: number;
  skipped: number;
  opened: number;
  restarted: number;
  promisesClosed: number;
  // Rows left `pending` for a later run: the cap or a failed call.
  waiting: number;
  failed: number;
  // The run stopped at a soft or configuration error of the model: no later mailbox runs.
  stopped: boolean;
}

export const emptyResult = (): AnalyzeResult => ({
  analysed: 0,
  skipped: 0,
  opened: 0,
  restarted: 0,
  promisesClosed: 0,
  waiting: 0,
  failed: 0,
  stopped: false,
});

// Everything one mailbox needs, read once per run.
async function mailboxEnv(db: DbOrTrx, ctx: TenantContext, mailboxId: string, now: Date): Promise<MailboxEnv | null> {
  const [organization, settings, mailboxes, delegates] = await Promise.all([
    getOrganization(db, ctx),
    getMailboxSettings(db, ctx, mailboxId),
    listMailboxes(db, ctx),
    listDelegates(db, ctx, { activeOnly: true }),
  ]);
  if (organization === undefined) return null;
  return {
    mailboxId,
    ownAddresses: mailboxes.map((mailbox) => mailbox.address),
    timeZone: organization.timezone,
    waitDays: settings?.loop_wait_days ?? FOLLOW_UP_MIN_WAIT_DAYS,
    delegates: delegates.map((delegate) => ({ id: delegate.id, email: delegate.email })),
    now,
  };
}

// Both organization flags and the switch of the mailbox: "Track my sent mail".
async function trackingOn(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  if (!(await isFeatureOn(db, ctx, "open_loops")) || !(await isFeatureOn(db, ctx, "sent_sync"))) return false;
  return (await getSentSyncState(db, ctx, mailboxId))?.enabled === true;
}

// Records the failed try of a row: one more try and a later retry; the third try ends it as `failed`. Never throws:
// a failed write is logged and the row stays as it is.
async function recordFailure(
  deps: AnalyzeDeps,
  ctx: TenantContext,
  env: MailboxEnv,
  row: SentCandidate
): Promise<"failed" | "waiting" | "lost"> {
  const attempts = row.attempts + 1;
  const write =
    attempts >= MAX_ATTEMPTS
      ? ({ status: "failed", attempts } as const)
      : ({
          status: "pending",
          skipReason: null,
          attempts,
          nextAttemptAt: new Date(env.now.getTime() + RETRY_STEP_MS * attempts),
        } as const);
  try {
    await inTransaction(deps.db, async (trx) => {
      if (await lockSentTracking(trx, ctx, env.mailboxId)) {
        await writeAnalysis(trx, ctx, { mailboxId: env.mailboxId, sentEmailId: row.id, write, at: env.now });
      }
    });
    return write.status === "failed" ? "failed" : "waiting";
  } catch (error) {
    log.with({ org_id: ctx.orgId, mailbox_id: env.mailboxId }).warn("sent_analysis_write_failed", errorFields(error));
    return "lost";
  }
}

// Every call attempt writes one `llm.call` row, so extractor calls count in the daily cap (the row of a failed call
// counts too). A failed audit write must not hide the answer.
async function recordCall(
  deps: AnalyzeDeps,
  ctx: TenantContext,
  mailboxId: string,
  call: { outcome: string; usage: LlmUsage | null; startedAt: number; now: Date }
): Promise<void> {
  const prompt = prompts.extractor;
  try {
    await recordLlmCall(deps.db, ctx, {
      mailboxId,
      role: prompt.role,
      promptVersion: prompt.version,
      model: call.usage?.model ?? deps.llm.modelOf(prompt.role),
      endpoint: call.usage?.endpoint ?? deps.llm.endpointOf(prompt.role),
      provider: call.usage?.provider ?? deps.llm.providerOf(prompt.role),
      outcome: call.outcome,
      tokensIn: call.usage?.tokensIn ?? null,
      tokensOut: call.usage?.tokensOut ?? null,
      latencyMs: Date.now() - call.startedAt,
      at: call.now,
    });
  } catch (error) {
    log.with({ org_id: ctx.orgId, mailbox_id: mailboxId }).warn("llm_audit_failed", errorFields(error));
  }
}

type RowOutcome = "analysed" | "skipped" | "waiting" | "failed" | "lost" | "stop" | "off";

// The cap: the calls of the mailbox in the quota day, all roles. This call must still fit under 80% of `dailyCap`, so the
// share never rounds up (a cap of 7 allows 5 calls, a cap of 3 allows 2, a cap of 1 allows none).
async function capReached(deps: AnalyzeDeps, ctx: TenantContext, mailboxId: string, now: Date): Promise<boolean> {
  const used = await countLlmCallsSince(deps.db, ctx, mailboxId, quotaDayStart(now, QUOTA_TIMEZONE));
  return (used + 1) * CAP_SHARE_DEN > deps.dailyCap * CAP_SHARE_NUM;
}

// One candidate: the rules, the cap, the call, the write.
async function analyzeRow(
  deps: AnalyzeDeps,
  ctx: TenantContext,
  env: MailboxEnv,
  row: SentCandidate,
  result: AnalyzeResult
): Promise<RowOutcome> {
  const rules = await applyRules(deps.db, ctx, env, row);
  if (rules.kind === "off") return "off";
  result.promisesClosed += rules.promisesClosed;
  if (rules.kind === "skipped") {
    result.restarted += rules.restarted;
    return "skipped";
  }
  // The rules passed `stored` rows with a text only; this keeps the call safe if that changes.
  if (row.bodyText === null) return "skipped";

  // A capped row waits until 5 minutes after the next quota day starts. No call.
  if (await capReached(deps, ctx, env.mailboxId, env.now)) {
    const nextAttemptAt = new Date(nextQuotaDayStart(env.now, QUOTA_TIMEZONE).getTime() + CAP_RETRY_AFTER_DAY_MS);
    await inTransaction(deps.db, async (trx) => {
      if (!(await lockSentTracking(trx, ctx, env.mailboxId))) return;
      await writeAnalysis(trx, ctx, {
        mailboxId: env.mailboxId,
        sentEmailId: row.id,
        write: { status: "pending", skipReason: "llm_cap", attempts: row.attempts, nextAttemptAt },
        at: env.now,
      });
    });
    return "waiting";
  }

  const prompt = prompts.extractor;
  const startedAt = Date.now();
  const answer = await extractSent(
    deps.llm,
    { subject: row.subject, bodyText: row.bodyText, sentAt: row.sentAt, to: row.to, cc: row.cc },
    { timeZone: env.timeZone }
  );
  if (answer.ok) {
    deps.pause.reset();
    await recordCall(deps, ctx, env.mailboxId, {
      outcome: "ok",
      usage: answer.usage,
      startedAt,
      now: env.now,
    });
    const written = await writeExtraction(deps.db, ctx, env, row, answer.result, prompt.version, (counterpart) =>
      contactWaitFor({ db: deps.db, credentialsKey: deps.credentialsKey }, ctx, env.mailboxId, counterpart)
    );
    if (written.kind === "off") return "off";
    if (written.kind === "written") result.opened += written.opened;
    return "analysed";
  }

  // A schema failure has the code of a bad output in the audit row, as the classifier writes it.
  await recordCall(deps, ctx, env.mailboxId, {
    outcome: answer.code === "schema" ? "bad_output" : answer.code,
    usage: null,
    startedAt,
    now: env.now,
  });
  log.with({ org_id: ctx.orgId, mailbox_id: env.mailboxId }).warn("sent_analysis_failed", { error_code: answer.code });
  // The quota or the service, or a wrong key or model: not the mail's fault. The row keeps its tries; the job pauses.
  // A timeout is the exception: one mail can time out on every call, so it counts as an attempt and ends `failed`.
  // On Gemini a schema rejection is a hard `http_400` (3 calls, then `failed`), not a configuration error.
  const soft = answer.code !== "timeout" && (softCodes as readonly string[]).includes(answer.code);
  if (soft || (configCodes as readonly string[]).includes(answer.code)) {
    deps.pause.trip(soft ? "soft" : "config", answer.code, env.now);
    return "stop";
  }
  return recordFailure(deps, ctx, env, row);
}

// The analysis of the Sent mail of one mailbox. It picks at most `limit` rows (oldest first), applies the rules that
// need no model, and calls the model for the rest. Runs only with both organization flags and the switch of the mailbox
// on. Logs counts and codes: no text and no address.
export async function analyzeSent(
  deps: AnalyzeDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number }
): Promise<AnalyzeResult> {
  const result = emptyResult();
  const { now } = opts;
  if (deps.pause.isPaused(now)) return result;
  if (!(await trackingOn(deps.db, ctx, mailboxId))) return result;
  const env = await mailboxEnv(deps.db, ctx, mailboxId, now);
  if (env === null) return result;
  const rows = await listSentCandidates(deps.db, ctx, mailboxId, {
    now,
    limit: opts.limit,
    testOnly: deps.scope.kind === "synthetic" ? deps.scope.testMail : null,
  });
  const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
  for (const row of rows) {
    let outcome: RowOutcome;
    try {
      outcome = await analyzeRow(deps, ctx, env, row, result);
    } catch (error) {
      // A row that breaks the write (a DB error) counts a try, so it cannot block the mailbox for ever.
      mailboxLog.warn("sent_analysis_failed", errorFields(error));
      outcome = await recordFailure(deps, ctx, env, row);
    }
    if (outcome === "off") break;
    if (outcome === "analysed") result.analysed += 1;
    else if (outcome === "skipped") {
      result.analysed += 1;
      result.skipped += 1;
    } else if (outcome === "waiting") result.waiting += 1;
    else if (outcome === "failed") result.failed += 1;
    else if (outcome === "stop") {
      result.stopped = true;
      break;
    }
  }
  if (result.analysed > 0) {
    mailboxLog.info("sent_analysis_done", { count: result.analysed, opened: result.opened });
  }
  return result;
}
