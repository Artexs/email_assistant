import {
  DEFAULT_SEND_LIMITS,
  draftPayloadSchema,
  hasGaps,
  sendPayloadSchema,
  sameAddresses,
  sendRecipients,
  type OutgoingMessage,
  type SendPayload,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { describeError, errorFields, HardError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit, type AuditData } from "../audit";
import { locateByActionId, MailAuthError, SmtpSendError, type AuthErrorReason, type MailProvider } from "../mail";

import {
  approvalHooksOf,
  authErrorOutcome,
  inTransaction,
  loopHooksOf,
  type ApplyDeps,
  type ApplyOutcome,
} from "./apply-shared";
import { closeSend, type CloseSendReason } from "./close";
import { DELEGATION_DUE_AFTER_MS, HARD_ERROR_TRIES, RETRY_WAIT_MS, SEND_SOFT_CAP_MS } from "./constants";
import { checkCopyBeforeSend, mustCheckCopy } from "./copy-check";
import { buildDraftMessage, loopAnchorOf, recipientsFromLoop } from "./drafts";
import { closeDraftOfSend } from "./expiry";
import { checkReplyBeforeSend } from "./reply-pass";
import {
  finishAction,
  getDraft,
  insertReverse,
  releaseAction,
  updateProviderResult,
  type ClaimedAction,
  type DraftRow,
} from "./repo";
import { startSendWithinLimits, type SendStart } from "./send-limit";

const log = createLog("actions");

export const SEND_RETRY_WAIT_MS = RETRY_WAIT_MS;
export const SEND_HARD_TRIES = HARD_ERROR_TRIES;
// `provider_result.cap` of a send that the soft-retry cap ended; the result notice reads it.
export const SOFT_CAP_MARK = "soft_retry";
// The notifier treats an older `pending` Sent copy as failed (D20).
export const SENT_COPY_PENDING_MAX_AGE_MS = 10 * 60_000;

type ProviderResult = Record<string, string | number | boolean | null>;

export type SendOutcome =
  | { kind: "auth_error"; reason?: AuthErrorReason }
  | { kind: "retry"; soft: boolean; count: boolean }
  | { kind: "failed"; reason: "smtp_rejected" | "smtp_error" | "outcome_unknown"; capped?: true };

// D11, F044. Pure. Maps an error of `sender.send` to what the row does. No branch sends again.
// `sinceTapMs` is the time since the tap (`approved_at`): a soft error at or after the cap ends the send.
export function sendOutcomeOf(error: unknown, attempts: number, sinceTapMs = 0): SendOutcome {
  if (error instanceof MailAuthError) return authErrorOutcome(error);
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

// The send and the draft of a reply: the same kind, the same To and the same Cc (lower case, as a set).
function sameReplyRecipients(
  send: { kind: string; to: readonly string[]; cc?: readonly string[] | undefined },
  draft: { kind: string; to: readonly string[]; cc?: readonly string[] }
): boolean {
  return (
    send.kind === "reply" &&
    draft.kind === "reply" &&
    sameAddresses(send.to, draft.to) &&
    sameAddresses(send.cc ?? [], draft.cc ?? [])
  );
}

// The payloads, the draft and the message. The draft's id and `created_at` give the draft APPEND's Message-ID and Date (D9).
// A follow-up is also checked against its loop: the send and the draft name the same loop, the send goes to nobody that the
// draft does not name, and nobody that the loop does not hold. `null`: the payload is bad.
async function prepare(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  draft: DraftRow
): Promise<Prepared | null> {
  const payload = sendPayloadSchema.safeParse(action.payload);
  const draftPayload = draftPayloadSchema.safeParse(draft.payload);
  if (!payload.success || !draftPayload.success) return null;
  const followUp = draftPayload.data.kind === "follow_up" ? draftPayload.data : null;
  if (
    (followUp === null) !== (action.loop_id === null) ||
    (followUp === null) !== (payload.data.kind !== "follow_up")
  ) {
    return null;
  }
  // A reply is checked like a follow-up: the send and the draft are both replies and name the same To and Cc, because
  // the envelope reads the send and the message headers read the draft. A recipient that only the send names gets nothing.
  if (
    (payload.data.kind === "reply" || draftPayload.data.kind === "reply") &&
    !sameReplyRecipients(payload.data, draftPayload.data)
  ) {
    return null;
  }
  const anchor = await loopAnchorOf(deps, ctx, action);
  if (followUp !== null) {
    const drafted = new Set(sendRecipients(followUp).map((address) => address.toLowerCase()));
    const same =
      anchor !== undefined &&
      payload.data.loop_id === followUp.loop_id &&
      followUp.loop_id === action.loop_id &&
      draft.loop_id === action.loop_id &&
      sendRecipients(payload.data).every((address) => drafted.has(address.toLowerCase())) &&
      recipientsFromLoop(payload.data, anchor);
    if (!same) return null;
  }
  const message = buildDraftMessage(
    deps,
    { ...action, id: draft.id, created_at: draft.created_at, payload: draft.payload },
    anchor
  );
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

// A reply whose effective text (`body_text ?? body`) holds a gap (`[[`) never goes out. The product cannot make such a send (the tap
// refuses it); this guards a hand edit of the database. The row ends `failed` / `has_gaps` before any SMTP call.
function replyHasGaps(draft: DraftRow): boolean {
  const payload = draftPayloadSchema.safeParse(draft.payload);
  return payload.success && payload.data.kind === "reply" && hasGaps(payload.data.body_text ?? payload.data.body);
}

const hasGapsFailure = (deps: ApplyDeps, ctx: TenantContext, action: ClaimedAction): Promise<ApplyOutcome> =>
  failSend(deps, ctx, action, {
    reason: "has_gaps",
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
    // A follow-up: the loop lock first, then the send row. The result of `isOpen` does not matter here: the mail
    // went out. The counters of the loop change either way.
    if (payload.kind === "follow_up" && action.loop_id !== null) {
      await loopHooksOf(deps).isOpen(trx, ctx, action.loop_id);
    }
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
        recipients: sendRecipients(payload).length,
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
    if (payload.kind === "follow_up" && action.loop_id !== null) {
      await loopHooksOf(deps).onFollowUpSent(trx, ctx, {
        loopId: action.loop_id,
        sendId: action.id,
        messageId: message.messageId,
        at: now,
      });
    }
    const folder = draft.provider_result?.folder;
    if (deps.mailbox.capabilities.uidplus && typeof folder === "string") {
      const uid = draft.provider_result?.uid;
      await insertReverse(trx, ctx, {
        id: draft.id,
        emailId: draft.email_id,
        loopId: draft.loop_id,
        type: "create_draft",
        payload: { kind: payload.kind, folder, uid: typeof uid === "number" ? uid : null, reason: "sent" },
      });
    }
    return true;
  });
}

// Graph saves the Sent copy itself, maybe some seconds after the 202. The send looks for it at 0, 5 and 15 s and never APPENDs one:
// a copy that arrives late would make two.
export const GRAPH_COPY_WAITS_MS: readonly number[] = [0, 5_000, 10_000];

async function waitForProviderCopy(
  deps: ApplyDeps,
  provider: MailProvider,
  folder: string,
  draft: DraftRow
): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (const wait of GRAPH_COPY_WAITS_MS) {
    if (wait > 0) await sleep(wait);
    const found = await locateByActionId(provider, folder, {
      actionId: draft.id,
      hintUid: null,
      since: draft.created_at,
    });
    if (found !== null) return true;
  }
  return false;
}

// Step 5: the Sent copy. Any error leaves the row `applied` with `sent_copy` `failed` (done-when).
// `provider`: a Graph send whose copy is not in Sent yet; the provider owns it (the result notice shows it as found).
async function saveSentCopy(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider,
  prepared: Prepared,
  raw: Buffer
): Promise<void> {
  const now = deps.now();
  let copy: "found" | "appended" | "provider";
  try {
    const folder = await deps.folders.resolve("sent");
    if (deps.mailbox.sendVia === "graph") {
      copy = (await waitForProviderCopy(deps, provider, folder, prepared.draft)) ? "found" : "provider";
    } else {
      const found = await locateByActionId(provider, folder, {
        actionId: prepared.draft.id,
        hintUid: null,
        since: prepared.draft.created_at,
      });
      if (found === null) await provider.appendMessage(folder, raw, ["\\Seen"], now);
      copy = found === null ? "appended" : "found";
    }
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
    log.warn("send_copy_failed", { action_id: action.id, ...errorFields(error) });
    return;
  }
  await updateProviderResult(deps.db, ctx, action.id, { sent_copy: copy });
}

// Errors of the steps before `markApplying`: the S3 hard-count rule, the row back to `approved`.
async function composeFailed(
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

// The read of the Drafts folder failed before the SMTP call (nothing is sent yet). A login error goes to the mailbox status. A soft
// error puts the send back to `approved` for 5 minutes with no count; it counts against the soft cap, like a soft SMTP error. A
// hard error counts as a try of the steps before `markApplying`.
async function copyCheckFailed(
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

// A claimed send that must not go out ends `expired` with the reason and no SMTP call is made. The copy in Drafts is removed through
// the reverse row of the draft, unless it changed (`removeDraft` keeps a changed copy). `notify: true`: the owner gets a result
// notice. A send of a loop takes the loop lock first.
async function closeForReason(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  reason: Extract<
    CloseSendReason,
    "draft_changed" | "draft_missing" | "answered" | "sent_by_user" | "newer_mail" | "original_moved"
  >
): Promise<ApplyOutcome> {
  const closed = await inTransaction(deps.db, async (trx) => {
    if (action.loop_id !== null) await loopHooksOf(deps).isOpen(trx, ctx, action.loop_id);
    return closeSend(trx, ctx, {
      sendId: action.id,
      reason,
      notify: true,
      claimed: true,
      now: deps.now(),
      deps: {
        hooks: deps.hooks,
        approvalHooks: approvalHooksOf(deps),
        uidplus: () => Promise.resolve(deps.mailbox.capabilities.uidplus),
      },
    });
  });
  if (closed.kind !== "closed") return { kind: "lost" };
  log.info("send_closed", { action_id: action.id, reason });
  return { kind: "expired", reason };
}

// The loop of a follow-up is closed (or gone) after the tap. The claimed `approved` send ends `expired` / `loop_closed`, and
// the draft copy goes with it (the close path of every send). The caller holds the loop lock.
async function closeSendOfClosedLoop(
  deps: ApplyDeps,
  trx: Transaction<DB>,
  ctx: TenantContext,
  action: ClaimedAction
): Promise<{ kind: "loop_closed" } | { kind: "lost" }> {
  const now = deps.now();
  if (
    !(await finishAction(
      trx,
      ctx,
      action.id,
      action.locked_at,
      { status: "expired", at: now, reason: "loop_closed" },
      { from: ["approved"] }
    ))
  ) {
    return { kind: "lost" };
  }
  await recordAudit(trx, ctx, {
    emailId: action.email_id,
    actionId: action.id,
    actor: "system",
    event: auditEvents.actionExpired,
    reasonCode: "loop_closed",
    data: { action_type: "send", reason: "loop_closed" },
    at: now,
  });
  if (action.depends_on_action_id !== null) {
    await closeDraftOfSend(trx, ctx, action.depends_on_action_id, {
      reason: "expired",
      now,
      uidplus: deps.mailbox.capabilities.uidplus,
    });
  }
  return { kind: "loop_closed" };
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
  const actionLog = log.with({ action_id: action.id });

  if (deps.sender === null) {
    actionLog.error("send_no_sender");
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
    actionLog.warn("send_waits_for_draft");
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
    prepared = await prepare(deps, ctx, action, draft);
    if (prepared !== null && replyHasGaps(draft)) return hasGapsFailure(deps, ctx, action);
    if (prepared !== null) raw = await deps.compose(prepared.message);
  } catch (error) {
    return composeFailed(deps, ctx, action, error);
  }
  if (prepared === null || raw === null) return badPayload(deps, ctx, action);
  const { payload, message } = prepared;

  // (1a) A reply only (F115 stage 09): the DB facts, the Sent pass and the flag of the original. A newer mail in the thread or a
  // moved original ends the send here. An answered mail is told to the copy check, which picks the reason. A delegation, a
  // clarification, a reminder and a follow-up never reach the Sent folder here.
  let answered = false;
  if (payload.kind === "reply") {
    const pass = await checkReplyBeforeSend(deps, ctx, action, provider, draft);
    if (pass.kind === "error") return copyCheckFailed(deps, ctx, action, pass.error);
    if (pass.kind === "close") return closeForReason(deps, ctx, action, pass.reason);
    answered = pass.answered;
  }

  // (1b) The edit check: the Drafts copy must be the one the system made. A reply always checks; another kind checks while the
  // org flag is on. Before any commit of the send, so a closed send never counts against the send limits.
  // A mail that is answered stops the send in every case; the copy tells why: unchanged → `answered` (the copy is removed), gone →
  // `sent_by_user` (the user sent it from the mail client), changed → `draft_changed` (the copy stays), never compared (no
  // baseline) → `answered` (the copy stays).
  if (mustCheckCopy(deps, payload.kind)) {
    const gate = await checkCopyBeforeSend(deps, action, provider, draft, payload.kind);
    if (gate.kind === "error") return copyCheckFailed(deps, ctx, action, gate.error);
    if (gate.kind === "close") {
      if (answered && gate.reason === "draft_missing") {
        return closeForReason(deps, ctx, action, gate.noBaseline === true ? "answered" : "sent_by_user");
      }
      return closeForReason(deps, ctx, action, gate.reason);
    }
  }
  if (answered) return closeForReason(deps, ctx, action, "answered");

  // (2) Own commit, before any SMTP call. The limit check and `markApplying` share one transaction under the mailbox lock (PD-044).
  // A follow-up goes only while its loop is open: `isOpen` takes the loop lock first, then the limit check and
  // `markApplying` run under it. A closed loop ends the claimed send here: no SMTP call.
  const start = await inTransaction(deps.db, async (trx): Promise<SendStart | { kind: "loop_closed" }> => {
    if (action.loop_id !== null && !(await loopHooksOf(deps).isOpen(trx, ctx, action.loop_id))) {
      return closeSendOfClosedLoop(deps, trx, ctx, action);
    }
    return startSendWithinLimits(trx, ctx, {
      action,
      mailboxId: deps.mailboxId,
      to: sendRecipients(payload),
      kind: payload.kind,
      outgoingMessageId: message.messageId,
      limits: deps.sendLimits ?? DEFAULT_SEND_LIMITS,
      now,
    });
  });
  if (start.kind === "lost") return { kind: "lost" };
  if (start.kind === "loop_closed") {
    actionLog.info("send_loop_closed", { mailbox_id: deps.mailboxId });
    return { kind: "expired", reason: "loop_closed" };
  }
  if (start.kind === "held") {
    actionLog.info("send_limited", { mailbox_id: deps.mailboxId, kind: start.hit.limit });
    try {
      deps.onSendLimited?.(ctx, start.hit);
    } catch (error) {
      actionLog.warn("send_limited_callback_failed", { ...errorFields(error) });
    }
    return { kind: "retry", soft: false };
  }

  // (3) The one SMTP call. The test hooks stand outside the `try`: a throw there is a crash.
  await deps.beforeSend?.();
  let result: Awaited<ReturnType<typeof sender.send>>;
  try {
    result = await sender.send({ envelope: { from: deps.mailbox.address, to: sendRecipients(payload) }, raw });
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
  actionLog.debug("action_applied", { action_type: "send" });

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
    const result = await prepare(deps, ctx, action, draft);
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
  log.debug("send_recovered", { action_id: action.id });
  return { kind: "applied" };
}
