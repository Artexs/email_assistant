import type { TenantContext } from "../../platform/db";
import { describeError, errorFields, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit, type AuditData } from "../audit";
import { MailAuthError, SmtpSendError } from "../mail";

import { authErrorOutcome, inTransaction, type ApplyDeps, type ApplyOutcome } from "./apply-shared";
import { SEND_SOFT_CAP_MS } from "./constants";
import { finishAction, releaseAction, type ClaimedAction } from "./repo";
import { SEND_HARD_TRIES, SEND_RETRY_WAIT_MS, SOFT_CAP_MARK, sendOutcomeOf } from "./send-outcome";

const log = createLog("actions");

export type ProviderResult = Record<string, string | number | boolean | null>;

interface Failure {
  reason: "smtp_rejected" | "smtp_error" | "outcome_unknown" | "bad_payload" | "has_gaps" | "copy_check_error";
  // The row is `approved` before `markApplying` (payload and compose errors), else `applying`.
  from: "approved" | "applying";
  cancel: "send_failed" | "outcome_unknown";
  lastError?: string;
  countAttempt?: true;
  providerResult: ProviderResult;
  auditData: AuditData;
  // The SMTP response number or the provider code, for the log line only (never the reply text).
  logCode?: string | number;
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
  log.warn("send_failed", {
    action_id: action.id,
    reason: failure.reason,
    send_stage: failure.providerResult.stage ?? "none",
    ...(failure.logCode === undefined ? {} : { code: failure.logCode }),
  });
  return { kind: "failed", reason: failure.reason };
}

export const badPayload = (deps: ApplyDeps, ctx: TenantContext, action: ClaimedAction): Promise<ApplyOutcome> =>
  failSend(deps, ctx, action, {
    reason: "bad_payload",
    from: "approved",
    cancel: "send_failed",
    providerResult: { stage: "payload" },
    auditData: { action_type: "send", stage: "payload" },
  });

export const hasGapsFailure = (deps: ApplyDeps, ctx: TenantContext, action: ClaimedAction): Promise<ApplyOutcome> =>
  failSend(deps, ctx, action, {
    reason: "has_gaps",
    from: "approved",
    cancel: "send_failed",
    providerResult: { stage: "payload" },
    auditData: { action_type: "send", stage: "payload" },
  });

// Errors of the steps before `markApplying`: the hard-count rule of the mailbox actions, the row back to `approved`.
export async function composeFailed(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  error: unknown,
  stage: "compose" | "copy_check" = "compose"
): Promise<ApplyOutcome> {
  const now = deps.now();
  const label = describeError(error);
  if (action.attempts + 1 >= SEND_HARD_TRIES) {
    return failSend(deps, ctx, action, {
      // An IMAP error of the copy check is not an SMTP error: it has its own reason and notice text.
      reason: stage === "copy_check" ? "copy_check_error" : "smtp_error",
      from: "approved",
      cancel: "send_failed",
      lastError: label,
      countAttempt: true,
      providerResult: { stage },
      auditData: { action_type: "send", stage, attempts: action.attempts + 1 },
    });
  }
  log.warn("send_retry", {
    action_id: action.id,
    attempts: action.attempts + 1,
    max_attempts: SEND_HARD_TRIES,
    ...errorFields(error),
  });
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
export async function sendFailed(
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
  // The log code: the response number, else the SMTP or system code; none for an error without a code.
  const logCode = responseCode ?? smtp?.code ?? errorFields(error).error_code;

  if (outcome.kind === "auth_error") {
    await releaseAction(deps.db, ctx, action.id, action.locked_at, {
      toStatus: "approved",
      nextAttemptAt: null,
      countAttempt: false,
      now,
    });
    return outcome;
  }
  if (outcome.kind === "retry") {
    log.warn("send_retry", {
      action_id: action.id,
      send_stage: stage,
      ...(logCode === undefined ? {} : { code: logCode }),
    });
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
    ...(logCode === undefined ? {} : { logCode }),
    from: "applying",
    cancel: outcome.reason === "outcome_unknown" ? "outcome_unknown" : "send_failed",
    lastError: outcome.reason === "outcome_unknown" ? `smtp_${code}` : lastError,
    // The third hard error counts (the hard-count rule of the mailbox actions); a content, unknown or capped soft error ends with `attempts` unchanged.
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

// The read of the Drafts folder failed before the SMTP call (nothing is sent yet). A login error goes to the mailbox status. A soft
// error puts the send back to `approved` for 5 minutes with no count; it counts against the soft cap, like a soft SMTP error. A
// hard error counts as a try of the steps before `markApplying`.
export async function copyCheckFailed(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  error: unknown
): Promise<ApplyOutcome> {
  const now = deps.now();
  if (error instanceof MailAuthError) {
    await releaseAction(deps.db, ctx, action.id, action.locked_at, {
      toStatus: "approved",
      nextAttemptAt: null,
      countAttempt: false,
      now,
    });
    return authErrorOutcome(error);
  }
  if (!(error instanceof SoftError)) return composeFailed(deps, ctx, action, error, "copy_check");
  const label = describeError(error);
  const sinceTapMs = action.approved_at === null ? 0 : now.getTime() - action.approved_at.getTime();
  if (sinceTapMs >= SEND_SOFT_CAP_MS) {
    return failSend(deps, ctx, action, {
      reason: "copy_check_error",
      from: "approved",
      cancel: "send_failed",
      lastError: label,
      providerResult: { stage: "copy_check", cap: SOFT_CAP_MARK },
      auditData: { action_type: "send", stage: "copy_check", cap: SOFT_CAP_MARK },
    });
  }
  log.warn("send_retry", { action_id: action.id, send_stage: "copy_check", ...errorFields(error) });
  await releaseAction(deps.db, ctx, action.id, action.locked_at, {
    toStatus: "approved",
    nextAttemptAt: new Date(now.getTime() + SEND_RETRY_WAIT_MS),
    countAttempt: false,
    now,
    lastError: label,
  });
  return { kind: "retry", soft: true };
}

export const unknownOutcome = (deps: ApplyDeps, ctx: TenantContext, action: ClaimedAction, lastError: string) =>
  failSend(deps, ctx, action, {
    reason: "outcome_unknown",
    from: "applying",
    cancel: "outcome_unknown",
    lastError,
    providerResult: { stage: "unknown", recovered: true },
    auditData: { action_type: "send", recovered: true },
  });

// Errors inside the recovery never put the row back to `approved` (no SMTP call here).
export async function recoveryFailed(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  error: unknown
): Promise<ApplyOutcome> {
  if (error instanceof MailAuthError) return authErrorOutcome(error);
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
  log.warn("send_recovery_retry", {
    action_id: action.id,
    attempts: action.attempts + 1,
    max_attempts: SEND_HARD_TRIES,
    ...errorFields(error),
  });
  await releaseAction(deps.db, ctx, action.id, action.locked_at, {
    toStatus: "applying",
    nextAttemptAt: new Date(now.getTime() + SEND_RETRY_WAIT_MS),
    countAttempt: !soft,
    now,
    lastError: label,
  });
  return { kind: "retry", soft };
}
