import {
  actionStatusFor,
  applyHardRules,
  autoFor,
  decideCategory,
  decidePolicy,
  delegationInputOf,
  nextQuotaDayStart,
  planActions,
  QUOTA_TIMEZONE,
  quotaDayStart,
  type Category,
  type CategoryPolicy,
  type DelegationInput,
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
import { createPlanned, setDelegationId, type CreatedAction, type PlannedActionInput } from "../actions";
import { auditEvents, countLlmCallsSince, recordAudit, recordLlmCall } from "../audit";
import { lockSettingsForShare } from "../config";
import { createDelegation, detectReply, markAnswered } from "../delegation";
import {
  finishEmail,
  isTestMail,
  listThreadContext,
  PENDING_BODY_DAYS,
  releaseEmail,
  type ClaimedEmail,
  type TestMailRule,
} from "../mail";

import { classifyEmail, type ClassifierEmail } from "./classifier";
import type { LlmPause } from "./pause";
import { prompts } from "./prompts";
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
  // The active delegates of the organization, read once per mailbox run.
  delegates: { id: string; name: string; email: string; tags: string[] }[];
  // The IANA zone of the organization (due dates).
  timezone: string;
  // The path of the mailbox's junk folder row (null: none), read once per run with the snapshot (D11).
  junkFolder: string | null;
  // `organizations.resumed_at` (null: never resumed). Drives the backlog rule of D4.
  resumedAt: Date | null;
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
  // The delegation plan input: only for a mail that the model called `delegation`.
  delegation: DelegationInput | null;
}

export interface TriageDeps {
  db: Db | Transaction<DB>;
  llm: LlmClient;
  pause: LlmPause;
  // Thread context of a test mail comes from test mail only.
  testMail: TestMailRule;
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

function payloadOf(action: PlannedAction): Record<string, unknown> {
  switch (action.type) {
    case "move":
      return { folder: action.folder };
    case "save_summary":
      return { summary: action.summary };
    case "create_draft":
      return action.draft;
    case "send":
      return action.send;
    case "mark_read":
    case "flag":
      return {};
  }
}

// D7: a delegate's reply closes the open delegation. Runs in the triage transaction, after `finishEmail`.
async function markReply(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  email: ClaimedEmail,
  now: Date
): Promise<string | null> {
  const found = await detectReply(trx, ctx, mailboxId, {
    fromAddress: email.from_address,
    inReplyTo: email.in_reply_to,
    referencesHeader: email.references_header,
  });
  if (found === null) return null;
  return (await markAnswered(trx, ctx, found.delegationId, { emailId: email.id, at: now })) ? found.delegationId : null;
}

// D6: a `ready` delegation draft with its send gets the `delegations` row; both payloads get its id (D2).
async function createDelegationRow(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailbox: TriageMailbox,
  email: ClaimedEmail,
  decision: TriageDecision,
  items: readonly PlannedActionInput[],
  created: readonly CreatedAction[],
  now: Date
): Promise<string | null> {
  if (decision.finalCategory !== "delegation") return null;
  const draft = created.find((action) => action.type === "create_draft");
  const send = created.find((action) => action.type === "send");
  const payload = items.find((item) => item.type === "create_draft")?.payload as
    | { kind?: string; delegate_id: string; task: string; due_date: string }
    | undefined;
  if (!draft || !send || draft.status !== "ready" || payload?.kind !== "delegation") return null;
  const delegationId = await createDelegation(trx, ctx, {
    mailboxId: mailbox.id,
    emailId: email.id,
    delegateId: payload.delegate_id,
    draftActionId: draft.id,
    sendActionId: send.id,
    task: payload.task,
    dueDate: payload.due_date || null,
    timezone: mailbox.timezone,
    now,
  });
  await setDelegationId(trx, ctx, [draft.id, send.id], delegationId);
  return delegationId;
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
  decision: TriageDecision,
  now: Date
): Promise<TriageOutcome> {
  const categoryAuto = autoFor(mailbox.policy, decision.finalCategory);
  const items: PlannedActionInput[] = planActions(
    decision.finalCategory,
    decision.summary,
    decision.delegation ?? undefined,
    { fromJunk: mailbox.junkFolder !== null && email.source_folder === mailbox.junkFolder }
  ).map((action) => ({
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
    ...(action.type === "send" ? { dependsOn: action.dependsOn } : {}),
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
    const answeredDelegationId = await markReply(trx, ctx, mailbox.id, email, now);
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
    const delegationId = await createDelegationRow(trx, ctx, mailbox, email, decision, items, created, now);
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
        ...(delegationId === null ? {} : { delegation_id: delegationId }),
        ...(answeredDelegationId === null ? {} : { answered_delegation_id: answeredDelegationId }),
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
  return saveTriage(
    deps.db,
    ctx,
    mailbox,
    email,
    {
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
      delegation: null,
    },
    deps.now()
  );
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
    return saveTriage(
      deps.db,
      ctx,
      mailbox,
      email,
      {
        finalCategory: "unsure",
        modelCategory: null,
        confidence: 0,
        reasonCode: "llm_blocked",
        reason: null,
        summary: null,
        fields: {},
        vip,
        model: null,
        promptVersion: prompts.classifier.version,
        usage: null,
        auditReasonCode: "llm_blocked",
        delegation: null,
      },
      now
    );
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

// Mail older than this before `resumed_at` is backlog of the pause (D4, A16).
export const BACKLOG_GRACE_MS = 24 * 3_600_000;

type SkipReason = "too_old" | "suspended_backlog" | "body_expired";

// One transaction: the email status `skipped` and its audit row. `false` in `finishEmail` means a lost claim.
// One function for both reasons, so the status and the audit code cannot drift.
async function skipEmail(
  deps: TriageDeps,
  ctx: TenantContext,
  mailbox: TriageMailbox,
  email: ClaimedEmail,
  reason: SkipReason
): Promise<TriageOutcome> {
  const run = async (trx: Transaction<DB>): Promise<TriageOutcome> => {
    if (!(await finishEmail(trx, ctx, email.id, email.locked_at, { status: "skipped", skipReason: reason }))) {
      log.warn(`triage ${email.id}: lost the claim`);
      return { kind: "lost" };
    }
    // A late reply still closes the loop.
    await markReply(trx, ctx, mailbox.id, email, deps.now());
    await recordAudit(trx, ctx, {
      emailId: email.id,
      actor: "system",
      event: auditEvents.emailSkipped,
      reasonCode: reason,
      data: { mailbox_id: mailbox.id },
    });
    return { kind: "skipped" };
  };
  return deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run);
}

// Triage one claimed email: age rules, hard rules, daily cap, then the classifier, then `saveTriage`.
// The `llm.call` rows go to `deps.db` outside the save transaction: a call counts also when the mail is lost.
export async function triageOne(
  deps: TriageDeps,
  ctx: TenantContext,
  mailbox: TriageMailbox,
  email: ClaimedEmail
): Promise<TriageOutcome> {
  if (email.backfilled_at === null && email.received_at.getTime() < deps.now().getTime() - MAX_AGE_MS) {
    return skipEmail(deps, ctx, mailbox, email, "too_old");
  }
  // After a pause: mail of before the pause that the first syncs after the resume stored (no LLM call).
  // A mail stored later (for example a folder switched on later) is triaged as usual.
  if (
    email.backfilled_at === null &&
    mailbox.resumedAt !== null &&
    email.received_at.getTime() < mailbox.resumedAt.getTime() - BACKLOG_GRACE_MS &&
    email.created_at.getTime() < mailbox.resumedAt.getTime() + BACKLOG_GRACE_MS
  ) {
    return skipEmail(deps, ctx, mailbox, email, "suspended_backlog");
  }
  // A backfilled mail is exempt from the age rules, so it can wait in `pending` past the retention period (a suspended
  // organization, scope `off`) and lose its body there. Without the body the classification is poor: no LLM call (F083).
  if (
    email.backfilled_at !== null &&
    email.body_text === null &&
    email.created_at.getTime() < deps.now().getTime() - PENDING_BODY_DAYS * 24 * 3_600_000
  ) {
    return skipEmail(deps, ctx, mailbox, email, "body_expired");
  }
  const rules = applyHardRules(email.from_address, mailbox.rules, { delegation: mailbox.delegates.length > 0 });
  if (rules.kind === "spam") {
    return saveTriage(
      deps.db,
      ctx,
      mailbox,
      email,
      {
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
        delegation: null,
      },
      deps.now()
    );
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
    syntheticOnly: isTestMail(
      { messageIdHeader: email.message_id_header, fromAddress: email.from_address },
      deps.testMail
    )
      ? { testMail: deps.testMail }
      : false,
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
      delegates: mailbox.delegates.map(({ id, name, tags }) => ({ id, name, tags })),
    });
  } catch (error) {
    // A failed audit write must not hide the LLM error from the rules below.
    try {
      await recordLlmCall(deps.db, ctx, {
        emailId: email.id,
        mailboxId: mailbox.id,
        role: "classifier",
        promptVersion: prompts.classifier.version,
        model: deps.llm.modelOf("classifier"),
        outcome: llmErrorCode(error),
        tokensIn: null,
        tokensOut: null,
        latencyMs: Date.now() - start,
        at: deps.now(),
      });
    } catch (auditError) {
      log.warn(`triage ${email.id}: llm.call audit write failed: ${describeError(auditError)}`);
    }
    return handleClassifyError(deps, ctx, mailbox, email, rules.vip, error);
  }
  deps.pause.reset();
  const { analysis, usage, promptVersion } = result;
  await recordLlmCall(deps.db, ctx, {
    emailId: email.id,
    mailboxId: mailbox.id,
    role: usage.role,
    promptVersion: usage.promptVersion,
    model: usage.model,
    outcome: "ok",
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    at: deps.now(),
  });

  const { category, belowThreshold } = decideCategory(analysis, mailbox.policy);
  const delegation = delegationInputOf(analysis, mailbox.delegates, email.from_address);
  return saveTriage(
    deps.db,
    ctx,
    mailbox,
    email,
    {
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
      delegation,
    },
    deps.now()
  );
}
