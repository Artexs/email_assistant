import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import { approvalHooksOf, inTransaction, loopHooksOf, type ApplyDeps, type ApplyOutcome } from "./apply-shared";
import { closeSend, type CloseSendReason } from "./close";
import { closeDraftOfSend } from "./expiry";
import { finishAction, type ClaimedAction } from "./repo";

const log = createLog("actions");

// A claimed send that must not go out ends `expired` with the reason and no SMTP call is made. The copy in Drafts is removed through
// the reverse row of the draft, unless it changed (`removeDraft` keeps a changed copy). `notify: true`: the owner gets a result
// notice. A send of a loop takes the loop lock first.
export async function closeForReason(
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
export async function closeSendOfClosedLoop(
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
