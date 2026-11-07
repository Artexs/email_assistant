import {
  actionStatusFor,
  applyHardRules,
  autoFor,
  decideCategory,
  decidePolicy,
  nextQuotaDayStart,
  planActions,
  QUOTA_TIMEZONE,
  quotaDayStart,
  type Category,
  type CategoryPolicy,
  type MailboxMode,
  type PlannedAction,
  type SenderRule,
  type ToolSwitches,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError, SoftError } from "../../platform/errors";
import { LlmBlockedError, LlmConfigError, llmErrorCode, type LlmClient, type LlmUsage } from "../../platform/llm";
import { createLog } from "../../platform/log";
import { createPlanned, type PlannedActionInput } from "../actions";
import { auditEvents, countLlmCallsSince, recordAudit } from "../audit";
import { lockSettingsForShare } from "../config";
import { finishEmail, isSyntheticMessageId, listThreadContext, releaseEmail, type ClaimedEmail } from "../mail";

import { classifyEmail, type ClassifierEmail } from "./classifier";
import type { LlmPause } from "./pause";
import { PROMPT_VERSION } from "./prompts/classifier-v1";
import { insertTriageResult } from "./repo";

const log = createLog("triage");

export interface TriageMailbox {
  id: string;
  // `mailbox_settings.updated_at` (as text) at the read of this snapshot; `saveTriage` compares it under a lock.
  settingsVersion: string;
  mode: MailboxMode;
  toolSwitches: ToolSwitches;
  policy: CategoryPolicy;
  rules: readonly SenderRule[];
  movesSupported: boolean;
}

export interface TriageDecision {
  finalCategory: Category;
  modelCategory: Category | null;
  confidence: number;
  // The model's code goes to `triage_results.reason_code`; the threshold never changes it.
  reasonCode: string;
  reason: string | null;
  summary: string | null;
  fields: Record<string, unknown>;
  vip: boolean;
  model: string | null;
  promptVersion: string | null;
  usage: LlmUsage | null;
  // The code of the `email.triaged` audit row.
  auditReasonCode: string;
}

export interface TriageDeps {
  db: Db | Transaction<DB>;
  llm: LlmClient;
  pause: LlmPause;
  // The most `llm.call` rows of one mailbox per quota day.
  dailyCap: number;
  now(): Date;
}

export type TriageOutcome =
  | { kind: "triaged" }
  | { kind: "lost" }
  | { kind: "retry_later" }
  // The settings changed after the snapshot: the mail went back without a count; the job drops its snapshot.
  | { kind: "settings_changed" }
  | { kind: "skipped" }
  | { kind: "capped"; until: Date; dayStart: Date }
  | { kind: "paused"; until: Date };

// A mail ends in `triage_error` when it reaches this many tries (the count includes stale take-backs).
export const HARD_ERROR_TRIES = 3;
const HARD_ERROR_WAIT_MS = 5 * 60_000;
// Mail older than this is not triaged, unless the backfill stored it (architecture §4.1 rule 8).
const MAX_AGE_MS = 7 * 24 * 3_600_000;

function payloadOf(action: PlannedAction): Record<string, string> {
  switch (action.type) {
    case "move":
      return { folder: action.folder };
    case "save_summary":
      return { summary: action.summary };
    default:
      return {};
  }
}

// One transaction: the email status, the result, the actions and the audit rows.
// A lost claim (another run took the mail) returns `lost` and writes nothing; it does not throw.
// The settings row is share-locked first, then the email row: a setter (FOR UPDATE on settings, then the action rows)
// cannot commit between the check and the action inserts. Changed settings: the mail goes back without a count
// (`settings_changed`) and the next run triages it with the new settings.
export async function saveTriage(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailbox: TriageMailbox,
  email: ClaimedEmail,
  decision: TriageDecision
): Promise<TriageOutcome> {
  const categoryAuto = autoFor(mailbox.policy, decision.finalCategory);
  const items: PlannedActionInput[] = planActions(decision.finalCategory, decision.summary).map((action) => ({
    type: action.type,
    payload: payloadOf(action),
    status: actionStatusFor(
      decidePolicy(action, {
        mode: mailbox.mode,
        toolSwitches: mailbox.toolSwitches,
        category: decision.finalCategory,
        categoryAuto,
        vip: decision.vip,
        movesSupported: mailbox.movesSupported,
      })
    ),
    idempotencyKey: `${email.id}:${action.type}`,
  }));

  const run = async (trx: Transaction<DB>): Promise<TriageOutcome> => {
    if ((await lockSettingsForShare(trx, ctx, mailbox.id)) !== mailbox.settingsVersion) {
      log.debug(`triage ${email.id}: settings changed, mail released`);
      const released = await releaseEmail(trx, ctx, email.id, email.locked_at, {
        nextAttemptAt: null,
        countAttempt: false,
      });
      return released ? { kind: "settings_changed" } : { kind: "lost" };
    }
    if (!(await finishEmail(trx, ctx, email.id, email.locked_at, { status: "triaged" }))) {
      log.warn(`triage ${email.id}: lost the claim`);
      return { kind: "lost" };
    }
    await insertTriageResult(trx, ctx, {
      emailId: email.id,
      category: decision.finalCategory,
      vip: decision.vip,
      confidence: decision.confidence,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      fields:
        decision.modelCategory === null
          ? decision.fields
          : { ...decision.fields, model_category: decision.modelCategory },
      model: decision.model,
      promptVersion: decision.promptVersion,
      tokensIn: decision.usage?.tokensIn ?? null,
      tokensOut: decision.usage?.tokensOut ?? null,
      latencyMs: decision.usage?.latencyMs ?? null,
    });
    const created = await createPlanned(trx, ctx, email.id, items);
    await recordAudit(trx, ctx, {
      emailId: email.id,
      actor: "system",
      event: auditEvents.emailTriaged,
      reasonCode: decision.auditReasonCode,
      data: {
        mailbox_id: mailbox.id,
        final_category: decision.finalCategory,
        model_category: decision.modelCategory,
        confidence: decision.confidence,
        prompt_version: decision.promptVersion,
        model: decision.model,
      },
    });
    for (const action of created) {
      await recordAudit(trx, ctx, {
        emailId: email.id,
        actionId: action.id,
        actor: "system",
        event: auditEvents.actionPlanned,
        data: { action_type: action.type, status: action.status },
      });
    }
    return { kind: "triaged" };
  };

  const result = await (db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run));
  if (result.kind === "triaged") {
    log.info(
      `triage ${email.id}: mailbox ${mailbox.id} category ${decision.finalCategory} code ${decision.auditReasonCode}`
    );
  }
  return result;
}

// The mail ends in `unsure` without an LLM answer. The job also uses it after 3 failed runs.
export async function finishTriageError(
  deps: TriageDeps,
  ctx: TenantContext,
  mailbox: TriageMailbox,
  email: ClaimedEmail
): Promise<TriageOutcome> {
  const rules = applyHardRules(email.from_address, mailbox.rules);
  return saveTriage(deps.db, ctx, mailbox, email, {
    finalCategory: "unsure",
    modelCategory: null,
    confidence: 0,
    reasonCode: "triage_error",
    reason: null,
    summary: null,
    fields: {},
    vip: rules.kind === "spam" ? false : rules.vip,
    model: null,
    promptVersion: null,
    usage: null,
    auditReasonCode: "triage_error",
  });
}

// The error rules for an error from `classifyEmail`; the `llm.call` row is already written.
async function handleClassifyError(
  deps: TriageDeps,
  ctx: TenantContext,
  mailbox: TriageMailbox,
  email: ClaimedEmail,
  vip: boolean,
  error: unknown
): Promise<TriageOutcome> {
  const now = deps.now();
  // Soft and config errors: the mail is not at fault. Release it without a count and pause the client.
  if (error instanceof SoftError || error instanceof LlmConfigError) {
    const kind = error instanceof SoftError ? "soft" : "config";
    const until = deps.pause.trip(kind, llmErrorCode(error), now);
    const released = await releaseEmail(deps.db, ctx, email.id, email.locked_at, {
      nextAttemptAt: until,
      countAttempt: false,
    });
    return released ? { kind: "paused", until } : { kind: "lost" };
  }
  if (error instanceof LlmBlockedError) {
    deps.pause.reset();
    return saveTriage(deps.db, ctx, mailbox, email, {
      finalCategory: "unsure",
      modelCategory: null,
      confidence: 0,
      reasonCode: "llm_blocked",
      reason: null,
      summary: null,
      fields: {},
      vip,
      model: null,
      promptVersion: PROMPT_VERSION,
      usage: null,
      auditReasonCode: "llm_blocked",
    });
  }
  if (email.attempts + 1 < HARD_ERROR_TRIES) {
    const released = await releaseEmail(deps.db, ctx, email.id, email.locked_at, {
      nextAttemptAt: new Date(now.getTime() + HARD_ERROR_WAIT_MS),
      countAttempt: true,
    });
    if (!released) return { kind: "lost" };
    log.warn(`triage ${email.id}: ${describeError(error)}, try ${email.attempts + 1} of ${HARD_ERROR_TRIES}`);
    return { kind: "retry_later" };
  }
  return finishTriageError(deps, ctx, mailbox, email);
}

// One transaction: the email status `skipped` and its audit row. `false` in `finishEmail` means a lost claim.
async function skipTooOld(
  deps: TriageDeps,
  ctx: TenantContext,
  mailbox: TriageMailbox,
  email: ClaimedEmail
): Promise<TriageOutcome> {
  const run = async (trx: Transaction<DB>): Promise<TriageOutcome> => {
    if (!(await finishEmail(trx, ctx, email.id, email.locked_at, { status: "skipped", skipReason: "too_old" }))) {
      log.warn(`triage ${email.id}: lost the claim`);
      return { kind: "lost" };
    }
    await recordAudit(trx, ctx, {
      emailId: email.id,
      actor: "system",
      event: auditEvents.emailSkipped,
      reasonCode: "too_old",
      data: { mailbox_id: mailbox.id },
    });
    return { kind: "skipped" };
  };
  return deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run);
}

// Triage one claimed email: age rule, hard rules, daily cap, then the classifier, then `saveTriage`.
// The `llm.call` rows go to `deps.db` outside the save transaction: a call counts also when the mail is lost.
export async function triageOne(
  deps: TriageDeps,
  ctx: TenantContext,
  mailbox: TriageMailbox,
  email: ClaimedEmail
): Promise<TriageOutcome> {
  if (email.backfilled_at === null && email.received_at.getTime() < deps.now().getTime() - MAX_AGE_MS) {
    return skipTooOld(deps, ctx, mailbox, email);
  }
  const rules = applyHardRules(email.from_address, mailbox.rules);
  if (rules.kind === "spam") {
    return saveTriage(deps.db, ctx, mailbox, email, {
      finalCategory: "spam",
      modelCategory: null,
      confidence: 1,
      reasonCode: "blocklist",
      reason: null,
      summary: null,
      fields: {},
      vip: false,
      model: null,
      promptVersion: null,
      usage: null,
      auditReasonCode: "blocklist",
    });
  }

  // Every call attempt counts, so the cap holds also when calls fail.
  const callTime = deps.now();
  const dayStart = quotaDayStart(callTime, QUOTA_TIMEZONE);
  if ((await countLlmCallsSince(deps.db, ctx, mailbox.id, dayStart)) >= deps.dailyCap) {
    const until = nextQuotaDayStart(callTime, QUOTA_TIMEZONE);
    const released = await releaseEmail(deps.db, ctx, email.id, email.locked_at, {
      nextAttemptAt: until,
      countAttempt: false,
    });
    return released ? { kind: "capped", until, dayStart } : { kind: "lost" };
  }

  const threadRows = await listThreadContext(deps.db, ctx, mailbox.id, email.thread_key, email.received_at, email.id, {
    syntheticOnly: isSyntheticMessageId(email.message_id_header),
  });
  const classifierEmail: ClassifierEmail = {
    from: email.from_address,
    to: email.to_addresses,
    cc: email.cc_addresses,
    subject: email.subject,
    receivedAt: email.received_at,
    bodyText: email.body_text,
    thread: threadRows.reverse().map((row) => ({
      from: row.from_address,
      subject: row.subject,
      receivedAt: row.received_at,
      bodyExcerpt: row.body_excerpt,
    })),
  };

  const start = Date.now();
  let result: Awaited<ReturnType<typeof classifyEmail>>;
  try {
    result = await classifyEmail(deps.llm, {
      email: classifierEmail,
      sender: { whitelisted: rules.whitelisted, vip: rules.vip, noreply: rules.noreply },
      allowed: rules.allowed,
    });
  } catch (error) {
    // A failed audit write must not hide the LLM error from the rules below.
    try {
      await recordAudit(deps.db, ctx, {
        emailId: email.id,
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: llmErrorCode(error),
        data: {
          mailbox_id: mailbox.id,
          model: deps.llm.classifierModel,
          prompt_version: PROMPT_VERSION,
          tokens_in: null,
          tokens_out: null,
          latency_ms: Date.now() - start,
        },
        at: deps.now(),
      });
    } catch (auditError) {
      log.warn(`triage ${email.id}: llm.call audit write failed: ${describeError(auditError)}`);
    }
    return handleClassifyError(deps, ctx, mailbox, email, rules.vip, error);
  }
  deps.pause.reset();
  const { analysis, usage, promptVersion } = result;
  await recordAudit(deps.db, ctx, {
    emailId: email.id,
    actor: "system",
    event: auditEvents.llmCall,
    reasonCode: "ok",
    data: {
      mailbox_id: mailbox.id,
      model: usage.model,
      prompt_version: promptVersion,
      tokens_in: usage.tokensIn,
      tokens_out: usage.tokensOut,
      latency_ms: usage.latencyMs,
    },
    at: deps.now(),
  });

  const { category, belowThreshold } = decideCategory(analysis, mailbox.policy);
  return saveTriage(deps.db, ctx, mailbox, email, {
    finalCategory: category,
    modelCategory: analysis.category,
    confidence: analysis.confidence,
    reasonCode: analysis.reason_code,
    reason: analysis.reason,
    summary: analysis.summary,
    fields: analysis.fields,
    vip: rules.vip,
    model: usage.model,
    promptVersion,
    usage,
    auditReasonCode: belowThreshold ? "below_threshold" : analysis.reason_code,
  });
}
