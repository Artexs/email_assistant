import { draftPayloadSchema, sendPayloadSchema, type OutgoingMessage, type SendPayload } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { describeError, HardError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit, type AuditData } from "../audit";
import { locateByActionId, MailAuthError, SmtpSendError, type MailProvider } from "../mail";

import { inTransaction, type ApplyDeps, type ApplyOutcome } from "./apply-shared";
import { DELEGATION_DUE_AFTER_MS, HARD_ERROR_TRIES, RETRY_WAIT_MS, SEND_SOFT_CAP_MS } from "./constants";
import { buildDraftMessage } from "./drafts";
import {
  finishAction,
  getDraft,
  insertReverse,
  markApplying,
  releaseAction,
  updateProviderResult,
  type ClaimedAction,
  type DraftRow,
} from "./repo";

const log = createLog("actions");

export const SEND_RETRY_WAIT_MS = RETRY_WAIT_MS;
export const SEND_HARD_TRIES = HARD_ERROR_TRIES;
// `provider_result.cap` of a send that the soft-retry cap ended; the result notice reads it.
export const SOFT_CAP_MARK = "soft_retry";
// The notifier treats an older `pending` Sent copy as failed (D20).
export const SENT_COPY_PENDING_MAX_AGE_MS = 10 * 60_000;

type ProviderResult = Record<string, string | number | boolean | null>;

export type SendOutcome =
  | { kind: "auth_error" }
  | { kind: "retry"; soft: boolean; count: boolean }
  | { kind: "failed"; reason: "smtp_rejected" | "smtp_error" | "outcome_unknown"; capped?: true };

// D11, F044. Pure. Maps an error of `sender.send` to what the row does. No branch sends again.
// `sinceTapMs` is the time since the tap (`approved_at`): a soft error at or after the cap ends the send.
export function sendOutcomeOf(error: unknown, attempts: number, sinceTapMs = 0): SendOutcome {
  if (error instanceof MailAuthError) return { kind: "auth_error" };
  // Not a typed SMTP error: the system cannot tell where the call stopped, so the mail may have gone out.
  if (!(error instanceof SmtpSendError) || error.stage === "unknown") {
    return { kind: "failed", reason: "outcome_unknown" };
  }
  if (error.stage === "content") {
    return { kind: "failed", reason: error.permanent ? "smtp_rejected" : "smtp_error" };
  }
  if (error.stage === "envelope" && error.permanent) return { kind: "failed", reason: "smtp_rejected" };
  if (error.soft) {
    if (sinceTapMs >= SEND_SOFT_CAP_MS) return { kind: "failed", reason: "smtp_error", capped: true };
    return { kind: "retry", soft: true, count: false };
  }
  if (attempts + 1 >= SEND_HARD_TRIES) return { kind: "failed", reason: "smtp_error" };
  return { kind: "retry", soft: false, count: true };
}

interface Prepared {
  draft: DraftRow;
  payload: SendPayload;
  message: OutgoingMessage;
}

interface Failure {
  reason: "smtp_rejected" | "smtp_error" | "outcome_unknown" | "bad_payload";
  // The row is `approved` before `markApplying` (payload and compose errors), else `applying`.
  from: "approved" | "applying";
  cancel: "send_failed" | "outcome_unknown";
  lastError?: string;
  countAttempt?: true;
  providerResult: ProviderResult;
  auditData: AuditData;
}

// The send-failure transaction: the row, its audit row and, for a delegation send, the delegation (send, then delegation).
async function failSend(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  failure: Failure
): Promise<ApplyOutcome> {
  const now = deps.now();
  const delegationId = typeof action.payload.delegation_id === "string" ? action.payload.delegation_id : null;
  const cancelsDelegation = delegationId !== null && action.payload.reminder === undefined;
  const done = await inTransaction(deps.db, async (trx) => {
    if (
      !(await finishAction(
        trx,
        ctx,
        action.id,
        action.locked_at,
        {
          status: "failed",
          at: now,
          reason: failure.reason,
          providerResult: failure.providerResult,
          ...(failure.lastError === undefined ? {} : { lastError: failure.lastError }),
          ...(failure.countAttempt ? { countAttempt: true as const } : {}),
        },
        { from: [failure.from] }
      ))
    ) {
      return false;
    }
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionFailed,
      reasonCode: failure.reason,
      data: failure.auditData,
      at: now,
    });
    if (cancelsDelegation) {
      await deps.hooks.onCancelled(trx, ctx, { delegationId, reason: failure.cancel, at: now });
    }
    return true;
  });
  if (!done) return { kind: "lost" };
  const stage = failure.providerResult.stage ?? "none";
  log.warn(
    `action ${action.id}: failed ${failure.reason} (stage ${stage}, code ${failure.providerResult.response_code ?? failure.providerResult.code ?? "none"})`
  );
  return { kind: "failed", reason: failure.reason };
}

// The payloads, the draft and the message. The draft's id and `created_at` give the draft APPEND's Message-ID and Date (D9).
function prepare(deps: ApplyDeps, action: ClaimedAction, draft: DraftRow): Prepared | null {
  const payload = sendPayloadSchema.safeParse(action.payload);
  if (!payload.success || !draftPayloadSchema.safeParse(draft.payload).success) return null;
  const message = buildDraftMessage(deps, {
    ...action,
    id: draft.id,
    created_at: draft.created_at,
    payload: draft.payload,
  });
  return { draft, payload: payload.data, message };
}

const badPayload = (deps: ApplyDeps, ctx: TenantContext, action: ClaimedAction): Promise<ApplyOutcome> =>
  failSend(deps, ctx, action, {
    reason: "bad_payload",
    from: "approved",
    cancel: "send_failed",
    providerResult: { stage: "payload" },
    auditData: { action_type: "send", stage: "payload" },
  });

// After the 250 (or the proof in Sent): one transaction. The row is `applied`, the delegation is `sent`, the draft gets a reverse row.
async function finishApplied(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  prepared: Prepared,
  providerResult: ProviderResult
): Promise<boolean> {
  const { draft, payload, message } = prepared;
  const now = deps.now();
  return inTransaction(deps.db, async (trx) => {
    if (
      !(await finishAction(
        trx,
        ctx,
        action.id,
        action.locked_at,
        { status: "applied", at: now, providerResult },
        { from: ["applying"] }
      ))
    ) {
      return false;
    }
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionApplied,
      data: {
        action_type: "send",
        kind: payload.kind,
        recipients: payload.to.length,
        delegation_id: payload.delegation_id ?? null,
        reminder: payload.reminder ?? null,
      },
      at: now,
    });
    if (payload.delegation_id !== undefined) {
      if (payload.reminder === undefined) {
        await deps.hooks.onSent(trx, ctx, {
          delegationId: payload.delegation_id,
          sentMessageId: message.messageId,
          sentAt: now,
          dueAtWhenNull: new Date(now.getTime() + DELEGATION_DUE_AFTER_MS),
        });
      } else {
        await deps.hooks.onReminderSent(trx, ctx, { delegationId: payload.delegation_id, at: now });
      }
    }
    const folder = draft.provider_result?.folder;
    if (deps.mailbox.capabilities.uidplus && typeof folder === "string") {
      const uid = draft.provider_result?.uid;
      await insertReverse(trx, ctx, {
        id: draft.id,
        emailId: draft.email_id,
        type: "create_draft",
        payload: { kind: payload.kind, folder, uid: typeof uid === "number" ? uid : null, reason: "sent" },
      });
    }
    return true;
  });
}

// Step 5: the Sent copy. Any error leaves the row `applied` with `sent_copy` `failed` (done-when).
async function saveSentCopy(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider,
  prepared: Prepared,
  raw: Buffer
): Promise<void> {
  const now = deps.now();
  let copy: "found" | "appended";
  try {
    const folder = await deps.folders.resolve("sent");
    const found = await locateByActionId(provider, folder, {
      actionId: prepared.draft.id,
      hintUid: null,
      since: prepared.draft.created_at,
    });
    if (found === null) await provider.appendMessage(folder, raw, ["\\Seen"], now);
    copy = found === null ? "appended" : "found";
  } catch (error) {
    const label = describeError(error);
    await inTransaction(deps.db, async (trx) => {
      await updateProviderResult(trx, ctx, action.id, { sent_copy: "failed" });
      await recordAudit(trx, ctx, {
        emailId: action.email_id,
        actionId: action.id,
        actor: "system",
        event: auditEvents.actionSentCopyFailed,
        data: { error: label },
        at: now,
      });
    });
    log.warn(`action ${action.id}: sent copy failed: ${label}`);
    return;
  }
  await updateProviderResult(deps.db, ctx, action.id, { sent_copy: copy });
}

// Errors of the steps before `markApplying`: the S3 hard-count rule, the row back to `approved`.
async function composeFailed(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  error: unknown
): Promise<ApplyOutcome> {
  const now = deps.now();
  const label = describeError(error);
  if (action.attempts + 1 >= SEND_HARD_TRIES) {
    return failSend(deps, ctx, action, {
      reason: "smtp_error",
      from: "approved",
      cancel: "send_failed",
      lastError: label,
      countAttempt: true,
      providerResult: { stage: "compose" },
      auditData: { action_type: "send", stage: "compose", attempts: action.attempts + 1 },
    });
  }
  log.warn(`action ${action.id}: ${label}, try ${action.attempts + 1} of ${SEND_HARD_TRIES}`);
  await releaseAction(deps.db, ctx, action.id, action.locked_at, {
    toStatus: "approved",
    nextAttemptAt: new Date(now.getTime() + SEND_RETRY_WAIT_MS),
    countAttempt: true,
    now,
    lastError: label,
  });
  return { kind: "retry", soft: false };
}

// The error of `sender.send` (step 3). The row is `applying`; no branch sends again in this call.
async function sendFailed(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  error: unknown
): Promise<ApplyOutcome> {
  const now = deps.now();
  const sinceTapMs = action.approved_at === null ? 0 : now.getTime() - action.approved_at.getTime();
  const outcome = sendOutcomeOf(error, action.attempts, sinceTapMs);
  const smtp = error instanceof SmtpSendError ? error : null;
  const stage = smtp?.stage ?? "unknown";
  const code = smtp?.code ?? describeError(error);
  const responseCode = smtp?.responseCode ?? null;
  const lastError = `smtp_${responseCode ?? code}`;

  if (outcome.kind === "auth_error") {
    await releaseAction(deps.db, ctx, action.id, action.locked_at, {
      toStatus: "approved",
      nextAttemptAt: null,
      countAttempt: false,
      now,
    });
    return { kind: "auth_error" };
  }
  if (outcome.kind === "retry") {
    log.warn(`action ${action.id}: send retry (stage ${stage}, code ${responseCode ?? code})`);
    await releaseAction(deps.db, ctx, action.id, action.locked_at, {
      toStatus: "approved",
      nextAttemptAt: new Date(now.getTime() + SEND_RETRY_WAIT_MS),
      countAttempt: outcome.count,
      now,
      lastError,
    });
    return { kind: "retry", soft: outcome.soft };
  }
  const providerResult: ProviderResult =
    outcome.reason === "outcome_unknown"
      ? { stage: "unknown", code }
      : { stage, response_code: responseCode, code, ...(outcome.capped ? { cap: SOFT_CAP_MARK } : {}) };
  return failSend(deps, ctx, action, {
    reason: outcome.reason,
    from: "applying",
    cancel: outcome.reason === "outcome_unknown" ? "outcome_unknown" : "send_failed",
    lastError: outcome.reason === "outcome_unknown" ? `smtp_${code}` : lastError,
    // The third hard error counts (S3 rule); a content, unknown or capped soft error ends with `attempts` unchanged.
    ...(outcome.reason === "smtp_error" && stage !== "content" && !outcome.capped
      ? { countAttempt: true as const }
      : {}),
    providerResult,
    auditData: {
      action_type: "send",
      stage,
      response_code: responseCode,
      ...(outcome.capped ? { cap: SOFT_CAP_MARK } : {}),
    },
  });
}

// D11. Approved → applying → SMTP → applied. At most once: after `markApplying` nothing here sends a second time.
export async function applySend(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider
): Promise<ApplyOutcome> {
  if (action.status === "applying") return recoverSend(deps, ctx, action, provider);
  const now = deps.now();

  if (deps.sender === null) {
    log.error(`action ${action.id}: no sender for send`);
    await releaseAction(deps.db, ctx, action.id, action.locked_at, {
      toStatus: action.status,
      nextAttemptAt: new Date(now.getTime() + SEND_RETRY_WAIT_MS),
      countAttempt: false,
      now,
    });
    return { kind: "retry", soft: true };
  }
  const sender = deps.sender;

  // (1) The draft, the payloads, the raw.
  const draft =
    action.depends_on_action_id === null ? undefined : await getDraft(deps.db, ctx, action.depends_on_action_id);
  if (draft === undefined || draft.status !== "applied") {
    log.warn(`action ${action.id}: the draft is not applied; the send waits`);
    await releaseAction(deps.db, ctx, action.id, action.locked_at, {
      toStatus: "approved",
      nextAttemptAt: new Date(now.getTime() + SEND_RETRY_WAIT_MS),
      countAttempt: false,
      now,
    });
    return { kind: "retry", soft: false };
  }
  let prepared: Prepared | null;
  let raw: Buffer | null = null;
  try {
    prepared = prepare(deps, action, draft);
    if (prepared !== null) raw = await deps.compose(prepared.message);
  } catch (error) {
    return composeFailed(deps, ctx, action, error);
  }
  if (prepared === null || raw === null) return badPayload(deps, ctx, action);
  const { payload, message } = prepared;

  // (2) Own commit, before any SMTP call.
  const started = await inTransaction(deps.db, async (trx) => {
    if (!(await markApplying(trx, ctx, action.id, action.locked_at, { outgoingMessageId: message.messageId }))) {
      return false;
    }
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionApplying,
      data: { action_type: "send", kind: payload.kind },
      at: now,
    });
    return true;
  });
  if (!started) return { kind: "lost" };

  // (3) The one SMTP call. The test hooks stand outside the `try`: a throw there is a crash.
  await deps.beforeSend?.();
  let result: Awaited<ReturnType<typeof sender.send>>;
  try {
    result = await sender.send({ envelope: { from: deps.mailbox.address, to: payload.to }, raw });
  } catch (error) {
    return sendFailed(deps, ctx, action, error);
  }
  await deps.afterSend?.();

  // (4) At once: the row is `applied` before anything else can fail.
  const done = await finishApplied(deps, ctx, action, prepared, {
    response: result.response,
    accepted: result.accepted.length,
    message_id: message.messageId,
    sent_copy: "pending",
  });
  // `lost`: the mail went out. The row stays `applying`; a recovery run ends it as `outcome_unknown`.
  if (!done) return { kind: "lost" };
  log.debug(`action ${action.id}: applied send`);

  // (5) The Sent copy never changes the outcome.
  await deps.beforeSentCopy?.();
  await saveSentCopy(deps, ctx, action, provider, prepared, raw);
  return { kind: "applied" };
}

const unknownOutcome = (deps: ApplyDeps, ctx: TenantContext, action: ClaimedAction, lastError: string) =>
  failSend(deps, ctx, action, {
    reason: "outcome_unknown",
    from: "applying",
    cancel: "outcome_unknown",
    lastError,
    providerResult: { stage: "unknown", recovered: true },
    auditData: { action_type: "send", recovered: true },
  });

// Errors inside the recovery never put the row back to `approved` (no SMTP call here).
async function recoveryFailed(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  error: unknown
): Promise<ApplyOutcome> {
  if (error instanceof MailAuthError) return { kind: "auth_error" };
  const now = deps.now();
  const label = describeError(error);
  const soft = error instanceof SoftError;
  if (!soft && action.attempts + 1 >= SEND_HARD_TRIES) {
    return failSend(deps, ctx, action, {
      reason: "outcome_unknown",
      from: "applying",
      cancel: "outcome_unknown",
      lastError: label,
      countAttempt: true,
      providerResult: { stage: "unknown", recovered: true },
      auditData: { action_type: "send", recovered: true },
    });
  }
  log.warn(`action ${action.id}: recovery ${label}, try ${action.attempts + 1} of ${SEND_HARD_TRIES}`);
  await releaseAction(deps.db, ctx, action.id, action.locked_at, {
    toStatus: "applying",
    nextAttemptAt: new Date(now.getTime() + SEND_RETRY_WAIT_MS),
    countAttempt: !soft,
    now,
    lastError: label,
  });
  return { kind: "retry", soft };
}

// D11, 12.2. A claimed `applying` send: the SMTP call may have started. Look in Sent; never send again.
async function recoverSend(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider
): Promise<ApplyOutcome> {
  let prepared: Prepared;
  let found: Awaited<ReturnType<typeof locateByActionId>>;
  try {
    const draft =
      action.depends_on_action_id === null ? undefined : await getDraft(deps.db, ctx, action.depends_on_action_id);
    if (draft === undefined) throw new HardError("draft not found");
    const result = prepare(deps, action, draft);
    if (result === null) throw new HardError("bad payload");
    prepared = result;
    const folder = await deps.folders.resolve("sent");
    found = await locateByActionId(provider, folder, {
      actionId: draft.id,
      hintUid: null,
      since: draft.created_at,
    });
  } catch (error) {
    return recoveryFailed(deps, ctx, action, error);
  }
  if (found === null) {
    return unknownOutcome(deps, ctx, action, "crash_in_applying");
  }
  const done = await finishApplied(deps, ctx, action, prepared, {
    recovered: true,
    sent_copy: "found",
    message_id: prepared.message.messageId,
  });
  if (!done) return { kind: "lost" };
  log.debug(`action ${action.id}: applied send (recovered)`);
  return { kind: "applied" };
}
