import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { auditEvents, recordAudit } from "../audit";

import { APPROVAL_TTL_MS, STALE_AFTER_MS } from "./constants";
import { closeDraftOfSend, expireSend } from "./expiry";
import type { DelegationHooks } from "./hooks";
import { getDraft, insertSendAgain, listSetSends, lockSend, setApproved, setRejected, type SendRow } from "./repo";

export interface ApprovalDeps {
  db: Db | Transaction<DB>;
  hooks: DelegationHooks;
  // Reads `mailboxes.capabilities`; a dependency so tests can set it.
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
}

export interface ApprovalInput {
  userId: string;
  via: "telegram" | "cli";
  now: Date;
}

export type ApproveResult =
  | { kind: "approved" }
  | { kind: "already_approved"; at: Date; byUserId: string | null }
  | { kind: "sent" }
  | { kind: "sending" }
  | { kind: "rejected" }
  | { kind: "expired"; byThisTap: boolean }
  | { kind: "failed"; reason: string | null }
  | { kind: "draft_not_ready" }
  | { kind: "not_found" };

export type RejectResult = { kind: "rejected" } | { kind: "already"; status: string } | { kind: "not_found" };

export type SendAgainResult =
  | { kind: "created"; actionId: string }
  | { kind: "already" }
  | { kind: "draft_gone" }
  | { kind: "delegation_closed" }
  | { kind: "not_failed" }
  | { kind: "not_found" };

function inTransaction<T>(db: Db | Transaction<DB>, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

function isStale(lockedAt: Date | null, now: Date): boolean {
  return lockedAt === null || lockedAt.getTime() < now.getTime() - STALE_AFTER_MS;
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
        await expireSend(trx, ctx, send.id, {
          reason: "timeout",
          now: input.now,
          actor: input.userId,
          hooks: deps.hooks,
          uidplus: await deps.uidplus(ctx, send.email.mailbox_id),
        });
        return { kind: "expired", byThisTap: true };
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
        data: { via: input.via },
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
      return { kind: "expired", byThisTap: false };
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
  input: ApprovalInput
): Promise<RejectResult> {
  const staleBefore = new Date(input.now.getTime() - STALE_AFTER_MS);
  if (!(await setRejected(trx, ctx, send.id, { at: input.now, staleBefore }))) {
    return { kind: "already", status: send.status };
  }
  await recordAudit(trx, ctx, {
    emailId: send.email_id,
    actionId: send.id,
    actor: input.userId,
    event: auditEvents.actionRejected,
    data: { via: input.via },
    at: input.now,
  });
  if (send.depends_on_action_id !== null) {
    await closeDraftOfSend(trx, ctx, send.depends_on_action_id, {
      reason: "rejected",
      now: input.now,
      uidplus: await deps.uidplus(ctx, send.email.mailbox_id),
    });
  }
  const delegationId = send.payload.delegation_id;
  if (typeof delegationId === "string" && !("reminder" in send.payload)) {
    await deps.hooks.onCancelled(trx, ctx, { delegationId, reason: "rejected", at: input.now });
  }
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
  input: ApprovalInput
): Promise<RejectResult> {
  return inTransaction(deps.db, async (trx) => {
    const send = await lockSend(trx, ctx, actionId);
    if (send === undefined) return { kind: "not_found" };
    return rejectRow(trx, deps, ctx, send, input);
  });
}

// Only the rows that the set message showed (`notified_at` set): a row whose draft failed was left out (D21).
function inSetMessage(send: SendRow): boolean {
  return send.status === "awaiting_approval" && send.notified_at !== null;
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
    if (failed === undefined) return { kind: "not_found" };
    if (
      failed.status !== "failed" ||
      (failed.status_reason !== "outcome_unknown" && failed.status_reason !== "smtp_error")
    ) {
      return { kind: "not_failed" };
    }
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
