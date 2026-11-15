import { sendPayloadSchema } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { auditEvents, recordAudit } from "../audit";

import { inTransaction } from "./apply-shared";
import { APPROVAL_TTL_MS, DELEGATION_DUE_AFTER_MS, STALE_AFTER_MS, UNNOTIFIED_TTL_MS } from "./constants";
import { closeDraftOfSend, expireSend } from "./expiry";
import type { ApprovalHooks, DelegationHooks, LoopHooks } from "./hooks";
import {
  findSendByKey,
  getDraft,
  insertSendAgain,
  listSetSends,
  lockSend,
  newestVersionOf,
  setApproved,
  setRejected,
  type SendRow,
} from "./repo";

export interface ApprovalDeps {
  db: Db | Transaction<DB>;
  hooks: DelegationHooks;
  // What a decision does for the cards of other channels: `approve`, `reject` and `editApproval` call `onDecided` in their
  // transaction after a change. The tap handler and the web build the real hook (`cardEditHooks`); `noApprovalHooks` does nothing.
  approvalHooks: ApprovalHooks;
  // Open loops: the edit of a follow-up reads its loop. Absent: `noLoopHooks` (a loop is never open, so the edit is refused).
  loopHooks?: LoopHooks;
  // Reads `mailboxes.capabilities`; a dependency so tests can set it.
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
}

export interface ApprovalInput {
  userId: string;
  via: "telegram" | "cli" | "web";
  now: Date;
}

// A reject can name the reason that the delegation gets when this send is its waiting draft (F102 stage 15: the user cancels the
// delegation). Default `rejected`. `user_cancelled` is final: no "Send again" or "It went out" reopens it.
export interface RejectInput extends ApprovalInput {
  delegationReason?: "user_cancelled";
}

export type ApproveResult =
  | { kind: "approved" }
  | { kind: "already_approved"; at: Date; byUserId: string | null }
  | { kind: "sent" }
  | { kind: "sending" }
  | { kind: "rejected" }
  | { kind: "expired"; byThisTap: boolean }
  | { kind: "failed"; reason: string | null }
  // A panel edit replaced this send: `currentId` is the newest version.
  | { kind: "superseded"; currentId: string }
  | { kind: "draft_not_ready" }
  | { kind: "not_found" };

export type RejectResult =
  | { kind: "rejected" }
  | { kind: "already"; status: string }
  | { kind: "superseded"; currentId: string }
  | { kind: "not_found" };

// The user whose own card the decision edits in place: the tap on a Telegram card edits that card itself, so the hook
// must leave it alone (D4). A decision from the panel or the CLI has no such card.
export function decidedBy(input: ApprovalInput): { exceptUserId?: string } {
  return input.via === "telegram" ? { exceptUserId: input.userId } : {};
}

// The audit data of a follow-up names its loop (a flat id); a mail send has none.
export function loopData(send: { loop_id: string | null }): { loop_id?: string } {
  return send.loop_id === null ? {} : { loop_id: send.loop_id };
}

// An `expired` send with the reason `superseded` is an old version: no decision applies to it.
function isSuperseded(send: SendRow): boolean {
  return send.status === "expired" && send.status_reason === "superseded";
}

export type SendAgainResult =
  | { kind: "created"; actionId: string }
  | { kind: "already" }
  | { kind: "draft_gone" }
  | { kind: "delegation_closed" }
  | { kind: "not_failed" }
  | { kind: "not_found" };

export type WentOutResult =
  | { kind: "went_out" }
  | { kind: "already" }
  | { kind: "sent_again" }
  | { kind: "not_unknown" }
  | { kind: "delegation_not_open" }
  | { kind: "not_found" };

function isStale(lockedAt: Date | null, now: Date): boolean {
  return lockedAt === null || lockedAt.getTime() < now.getTime() - STALE_AFTER_MS;
}

// A tap or a panel approve that finds the send past its time limit closes it. The cards of the other owners lose their buttons
// (F102 stage 18: this path queued no card edit before); the tapped card of a Telegram tap is the handler's own edit.
async function expireByTap(
  trx: Transaction<DB>,
  deps: ApprovalDeps,
  ctx: TenantContext,
  send: SendRow,
  input: ApprovalInput,
  reason: "timeout" | "not_notified"
): Promise<ApproveResult> {
  const closed = await expireSend(trx, ctx, send.id, {
    reason,
    now: input.now,
    actor: input.userId,
    hooks: deps.hooks,
    uidplus: await deps.uidplus(ctx, send.mailbox_id),
  });
  if (closed) {
    await deps.approvalHooks.onDecided(trx, ctx, {
      sendId: send.id,
      decision: "expired",
      ...decidedBy(input),
      at: input.now,
    });
  }
  return { kind: "expired", byThisTap: true };
}

// The caller holds the lock of the row. The owner check is the caller's (D26): the Telegram handler checks the role.
async function approveRow(
  trx: Transaction<DB>,
  deps: ApprovalDeps,
  ctx: TenantContext,
  send: SendRow,
  input: ApprovalInput
): Promise<ApproveResult> {
  switch (send.status) {
    case "awaiting_approval": {
      // The hourly job is late by up to an hour: a tap in that window must not send (D18).
      if (send.notified_at !== null && send.notified_at.getTime() + APPROVAL_TTL_MS < input.now.getTime()) {
        return expireByTap(trx, deps, ctx, send, input, "timeout");
      }
      // A send that no owner was told about (`notified_at` null: no linked Telegram chat) has the 7-day limit of the expiry job; the panel
      // can approve it, so the check runs here too, for the same reason: the hourly job is late by up to an hour.
      if (send.notified_at === null && send.created_at.getTime() + UNNOTIFIED_TTL_MS < input.now.getTime()) {
        return expireByTap(trx, deps, ctx, send, input, "not_notified");
      }
      // A send whose draft is not in Drafts yet (or never will be) must not go out: the tap changes nothing.
      const draft =
        send.depends_on_action_id === null ? undefined : await getDraft(trx, ctx, send.depends_on_action_id);
      if (draft?.status !== "applied") return { kind: "draft_not_ready" };
      const changed = await setApproved(trx, ctx, send.id, { userId: input.userId, via: input.via, at: input.now });
      if (!changed) throw new HardError("a locked awaiting_approval send did not change");
      await recordAudit(trx, ctx, {
        emailId: send.email_id,
        actionId: send.id,
        actor: input.userId,
        event: auditEvents.actionApproved,
        data: { via: input.via, ...loopData(send) },
        at: input.now,
      });
      await deps.approvalHooks.onDecided(trx, ctx, {
        sendId: send.id,
        decision: "approved",
        ...decidedBy(input),
        at: input.now,
      });
      return { kind: "approved" };
    }
    case "approved":
      return isStale(send.locked_at, input.now)
        ? { kind: "already_approved", at: send.approved_at ?? input.now, byUserId: send.approved_by }
        : { kind: "sending" };
    case "applying":
      return { kind: "sending" };
    case "applied":
      return { kind: "sent" };
    case "rejected":
      return { kind: "rejected" };
    case "expired":
      return isSuperseded(send)
        ? { kind: "superseded", currentId: await newestVersionOf(trx, ctx, send.id) }
        : { kind: "expired", byThisTap: false };
    case "failed":
      return { kind: "failed", reason: send.status_reason };
    default:
      return { kind: "not_found" };
  }
}

async function rejectRow(
  trx: Transaction<DB>,
  deps: ApprovalDeps,
  ctx: TenantContext,
  send: SendRow,
  input: RejectInput
): Promise<RejectResult> {
  const staleBefore = new Date(input.now.getTime() - STALE_AFTER_MS);
  if (!(await setRejected(trx, ctx, send.id, { at: input.now, staleBefore }))) {
    if (isSuperseded(send)) return { kind: "superseded", currentId: await newestVersionOf(trx, ctx, send.id) };
    return { kind: "already", status: send.status };
  }
  await recordAudit(trx, ctx, {
    emailId: send.email_id,
    actionId: send.id,
    actor: input.userId,
    event: auditEvents.actionRejected,
    data: { via: input.via, ...loopData(send) },
    at: input.now,
  });
  if (send.depends_on_action_id !== null) {
    await closeDraftOfSend(trx, ctx, send.depends_on_action_id, {
      reason: "rejected",
      now: input.now,
      uidplus: await deps.uidplus(ctx, send.mailbox_id),
    });
  }
  const delegationId = send.payload.delegation_id;
  if (typeof delegationId === "string" && !("reminder" in send.payload)) {
    await deps.hooks.onCancelled(trx, ctx, {
      delegationId,
      reason: input.delegationReason ?? "rejected",
      at: input.now,
      // The user's own cancel is the user's act: the audit row of the delegation names the user and the channel.
      ...(input.delegationReason === undefined ? {} : { actor: input.userId, via: input.via }),
    });
  }
  await deps.approvalHooks.onDecided(trx, ctx, {
    sendId: send.id,
    decision: "rejected",
    ...decidedBy(input),
    at: input.now,
  });
  return { kind: "rejected" };
}

// D18: the only way a send becomes `approved`. One transaction.
export async function approve(
  deps: ApprovalDeps,
  ctx: TenantContext,
  actionId: string,
  input: ApprovalInput
): Promise<ApproveResult> {
  return inTransaction(deps.db, async (trx) => {
    const send = await lockSend(trx, ctx, actionId);
    if (send === undefined) return { kind: "not_found" };
    return approveRow(trx, deps, ctx, send, input);
  });
}

export async function reject(
  deps: ApprovalDeps,
  ctx: TenantContext,
  actionId: string,
  input: RejectInput
): Promise<RejectResult> {
  return inTransaction(deps.db, async (trx) => {
    const send = await lockSend(trx, ctx, actionId);
    if (send === undefined) return { kind: "not_found" };
    return rejectRow(trx, deps, ctx, send, input);
  });
}

// Only the rows that the set message showed (`notified_at` set): a row whose draft failed was left out (D21).
// A follow-up is never in a set (belt and braces: the set readers are mail-only, and the payload schema refuses `set_id` on it).
function inSetMessage(send: SendRow): boolean {
  return send.status === "awaiting_approval" && send.notified_at !== null && send.loop_id === null;
}

export async function approveSet(
  deps: ApprovalDeps,
  ctx: TenantContext,
  setId: string,
  input: ApprovalInput
): Promise<{ approved: number; skipped: number; approvedIds: string[] }> {
  return inTransaction(deps.db, async (trx) => {
    const approvedIds: string[] = [];
    let approved = 0;
    let skipped = 0;
    for (const send of await listSetSends(trx, ctx, setId)) {
      const result = inSetMessage(send) ? await approveRow(trx, deps, ctx, send, input) : undefined;
      if (result?.kind === "approved") {
        approved += 1;
        approvedIds.push(send.id);
      } else skipped += 1;
    }
    return { approved, skipped, approvedIds };
  });
}

export async function rejectSet(
  deps: ApprovalDeps,
  ctx: TenantContext,
  setId: string,
  input: ApprovalInput
): Promise<{ rejected: number; skipped: number }> {
  return inTransaction(deps.db, async (trx) => {
    let rejected = 0;
    let skipped = 0;
    for (const send of await listSetSends(trx, ctx, setId)) {
      const result = inSetMessage(send) ? await rejectRow(trx, deps, ctx, send, input) : undefined;
      if (result?.kind === "rejected") rejected += 1;
      else skipped += 1;
    }
    return { rejected, skipped };
  });
}

// D18: one resend per failed row (`:again` key). The delegation stays `cancelled` until the new send is `applied` (D6).
// A delegation or reminder send whose delegation is closed gets `delegation_closed` and no row.
export async function sendAgain(
  deps: ApprovalDeps,
  ctx: TenantContext,
  failedActionId: string,
  input: ApprovalInput
): Promise<SendAgainResult> {
  return inTransaction(deps.db, async (trx) => {
    const failed = await lockSend(trx, ctx, failedActionId);
    // A follow-up has no "Send again": after `outcome_unknown` the mail may have gone out to other people, and a new one is
    // drafted from its loop (the failure notice has no such button). A forged tap on one answers like an unknown id.
    if (failed === undefined || failed.loop_id !== null) return { kind: "not_found" };
    if (
      failed.status !== "failed" ||
      (failed.status_reason !== "outcome_unknown" && failed.status_reason !== "smtp_error")
    ) {
      return { kind: "not_failed" };
    }
    // A24: retention cleared the payload of an old failed send; there is nothing to send again.
    if (!sendPayloadSchema.safeParse(failed.payload).success) return { kind: "draft_gone" };
    const draft =
      failed.depends_on_action_id === null ? undefined : await getDraft(trx, ctx, failed.depends_on_action_id);
    if (draft === undefined || draft.status !== "applied") return { kind: "draft_gone" };
    // A resend of a delegation or reminder send needs its delegation in a state that takes the send (lock order: send, then delegation).
    const delegationId = failed.payload.delegation_id;
    const kind = failed.payload.kind;
    if (typeof delegationId === "string" && (kind === "reminder" || kind === "delegation")) {
      if (!(await deps.hooks.isOpen(trx, ctx, delegationId, kind))) return { kind: "delegation_closed" };
    }
    const actionId = await insertSendAgain(trx, ctx, failed, { userId: input.userId, via: input.via, at: input.now });
    if (actionId === null) return { kind: "already" };
    await recordAudit(trx, ctx, {
      emailId: failed.email_id,
      actionId,
      actor: input.userId,
      event: auditEvents.actionSendAgain,
      data: { previous_action_id: failedActionId },
      at: input.now,
    });
    return { kind: "created", actionId };
  });
}

// "It went out" (F041): a delegation send ended `failed` / `outcome_unknown`, and the owner says that the mail reached the delegate.
// The delegation goes `cancelled` -> `sent` with the message id that the send stored. No SMTP call; the send row stays `failed`.
// A send that was sent again, or a delegation in another state, changes nothing (lock order: send, then delegation).
export async function markWentOut(
  deps: ApprovalDeps,
  ctx: TenantContext,
  failedActionId: string,
  input: ApprovalInput
): Promise<WentOutResult> {
  return inTransaction(deps.db, async (trx) => {
    const failed = await lockSend(trx, ctx, failedActionId);
    if (failed === undefined || failed.loop_id !== null) return { kind: "not_found" };
    const delegationId = failed.payload.delegation_id;
    if (
      failed.status !== "failed" ||
      failed.status_reason !== "outcome_unknown" ||
      failed.payload.kind !== "delegation" ||
      typeof delegationId !== "string" ||
      failed.outgoing_message_id === null
    ) {
      return { kind: "not_unknown" };
    }
    if ((await findSendByKey(trx, ctx, `${failedActionId}:again`)) !== undefined) return { kind: "sent_again" };
    const result = await deps.hooks.onWentOut(trx, ctx, {
      delegationId,
      sentMessageId: failed.outgoing_message_id,
      at: input.now,
      dueAtWhenNull: new Date(input.now.getTime() + DELEGATION_DUE_AFTER_MS),
      actor: input.userId,
    });
    if (result === "already") return { kind: "already" };
    if (result === "not_open") return { kind: "delegation_not_open" };
    await recordAudit(trx, ctx, {
      emailId: failed.email_id,
      actionId: failedActionId,
      actor: input.userId,
      event: auditEvents.actionWentOut,
      data: { delegation_id: delegationId, outgoing_message_id: failed.outgoing_message_id, via: input.via },
      at: input.now,
    });
    return { kind: "went_out" };
  });
}
