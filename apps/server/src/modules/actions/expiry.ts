import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";

import { STALE_AFTER_MS } from "./constants";
import { noDelegationHooks, type DelegationHooks } from "./hooks";
import { expireReadyDraft, insertReverse, listOpenReminderSends, lockDraft, lockSend, setExpired } from "./repo";

export type SendCloseReason =
  | "timeout"
  | "draft_missing"
  | "not_notified"
  | "held_timeout"
  | "policy_changed"
  | "delegation_closed";

// An `approved` send closes only for these reasons; a tap was given, so a plain timeout of the request does not apply (D22).
const CLOSES_APPROVED: readonly SendCloseReason[] = ["held_timeout", "delegation_closed"];

// D22: the cascade for one send. The caller holds the transaction.
// false = the row was not in a closable state (a tap, a send or another close won).
// A send in flight (`applying`, or `approved` with a fresh lock) finishes. `result_notified_at` stays null (D20).
export async function expireSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  sendId: string,
  opts: { reason: SendCloseReason; now: Date; actor: string; hooks: DelegationHooks; uidplus: boolean }
): Promise<boolean> {
  const send = await lockSend(trx, ctx, sendId);
  if (send === undefined) return false;
  const staleBefore = new Date(opts.now.getTime() - STALE_AFTER_MS);
  if (send.status === "approved") {
    if (!CLOSES_APPROVED.includes(opts.reason)) return false;
    if (send.locked_at !== null && send.locked_at >= staleBefore) return false;
  } else if (send.status !== "awaiting_approval") {
    return false;
  }
  const changed = await setExpired(trx, ctx, sendId, {
    reason: opts.reason,
    at: opts.now,
    from: send.status as "awaiting_approval" | "approved",
    staleBefore,
  });
  if (!changed) return false;
  await recordAudit(trx, ctx, {
    emailId: send.email_id,
    actionId: sendId,
    actor: opts.actor,
    event: auditEvents.actionExpired,
    reasonCode: opts.reason,
    data: { action_type: "send", reason: opts.reason },
    at: opts.now,
  });
  if (send.depends_on_action_id !== null) {
    await closeDraftOfSend(trx, ctx, send.depends_on_action_id, {
      reason: "expired",
      now: opts.now,
      uidplus: opts.uidplus,
    });
  }
  const delegationId = send.payload.delegation_id;
  if (typeof delegationId === "string" && !("reminder" in send.payload) && opts.reason !== "delegation_closed") {
    await opts.hooks.onCancelled(trx, ctx, {
      delegationId,
      reason: opts.reason === "draft_missing" ? "draft_missing" : "expired",
      at: opts.now,
    });
  }
  return true;
}

// D13: the draft of a dead send never lands and never stays behind when the server has UIDPLUS.
// `ready` → expired; `applied` + UIDPLUS → a reverse row; the rest is left to its own step or stays.
export async function closeDraftOfSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  draftId: string,
  opts: { reason: "sent" | "rejected" | "expired"; now: Date; uidplus: boolean }
): Promise<"reverse" | "expired" | "none"> {
  const draft = await lockDraft(trx, ctx, draftId);
  if (draft === undefined) return "none";
  if (draft.status === "ready") {
    if (!(await expireReadyDraft(trx, ctx, draftId, opts.now))) return "none";
    await recordAudit(trx, ctx, {
      emailId: draft.email_id,
      actionId: draftId,
      actor: "system",
      event: auditEvents.actionExpired,
      reasonCode: "send_closed",
      data: { action_type: "create_draft", reason: opts.reason },
      at: opts.now,
    });
    return "expired";
  }
  if (draft.status === "applied" && opts.uidplus) {
    const kind = draft.payload.kind;
    const folder = draft.provider_result?.folder;
    const uid = draft.provider_result?.uid;
    if (typeof kind !== "string" || typeof folder !== "string") return "none";
    await insertReverse(trx, ctx, {
      id: draftId,
      emailId: draft.email_id,
      type: "create_draft",
      payload: { kind, folder, uid: typeof uid === "number" ? uid : null, reason: opts.reason },
    });
    return "reverse";
  }
  return "none";
}

// D6: a delegation that is answered, done or cancelled sends no more reminders. Every open reminder send closes with its draft.
// The caller holds the delegation lock (lock order, D6). An `applying` reminder finishes.
export async function expireReminderActions(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegationId: string,
  opts: { now: Date; uidplus: boolean; actor: string }
): Promise<{ sends: number }> {
  const ids = await listOpenReminderSends(trx, ctx, delegationId);
  let sends = 0;
  for (const id of ids) {
    const closed = await expireSend(trx, ctx, id, {
      reason: "delegation_closed",
      now: opts.now,
      actor: opts.actor,
      hooks: noDelegationHooks,
      uidplus: opts.uidplus,
    });
    if (closed) sends += 1;
  }
  return { sends };
}
