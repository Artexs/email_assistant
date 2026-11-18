import { DEFAULT_SEND_LIMITS, sendRecipients } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { errorFields, HardError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { locateByActionId, type MailProvider } from "../mail";

import { type ApplyDeps, type ApplyOutcome, inTransaction, loopHooksOf } from "./apply-shared";
import { checkCopyBeforeSend, mustCheckCopy } from "./copy-check";
import { checkReplyBeforeSend } from "./reply-pass";
import { getDraft, releaseAction, type ClaimedAction } from "./repo";
import { closeForReason, closeSendOfClosedLoop } from "./send-close";
import {
  badPayload,
  composeFailed,
  copyCheckFailed,
  hasGapsFailure,
  recoveryFailed,
  sendFailed,
  unknownOutcome,
} from "./send-failure";
import { finishApplied, saveSentCopy } from "./send-finish";
import { startSendWithinLimits, type SendStart } from "./send-limit";
import { SEND_RETRY_WAIT_MS } from "./send-outcome";
import { prepare, replyHasGaps, type Prepared } from "./send-prepare";

const log = createLog("actions");

// The names that other files import from `./send` stay here; their code is in `send-outcome.ts`.
export {
  SEND_HARD_TRIES,
  SEND_RETRY_WAIT_MS,
  SENT_COPY_PENDING_MAX_AGE_MS,
  SOFT_CAP_MARK,
  sendOutcomeOf,
  type SendOutcome,
} from "./send-outcome";

// Approved → applying → SMTP → applied. At most once: after `markApplying` nothing here sends a second time.
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

  // (1a) A reply only: the DB facts, the Sent pass and the flag of the original. A newer mail in the thread or a
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

  // (2) Own commit, before any SMTP call. The limit check and `markApplying` share one transaction under the mailbox lock.
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

// A claimed `applying` send: the SMTP call may have started. Look in Sent; never send again.
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
