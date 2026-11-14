import type { RejectReason } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";

import { inTransaction } from "./apply-shared";
import { insertMistakeOnce, lockSend, upsertRejectReason, type ActionFeedbackVia } from "./repo";

// A mistake can be marked within 7 days of the send (D21).
export const MISTAKE_WINDOW_MS = 7 * 24 * 3_600_000;

export type RejectReasonResult = { kind: "saved" } | { kind: "not_rejected" } | { kind: "not_found" };
export type MistakeResult =
  | { kind: "saved" }
  | { kind: "already" }
  | { kind: "too_late" }
  | { kind: "not_sent" }
  | { kind: "not_found" };

type Conn = Db | Transaction<DB>;

/** The caller checks the owner role. Only a `send` with status `rejected`; a later reason replaces the earlier one. */
export async function recordRejectReason(
  db: Conn,
  ctx: TenantContext,
  input: { actionId: string; reason: RejectReason; userId: string; via: ActionFeedbackVia; now: Date }
): Promise<RejectReasonResult> {
  return inTransaction(db, async (trx) => {
    const send = await lockSend(trx, ctx, input.actionId);
    if (send === undefined) return { kind: "not_found" };
    if (send.status !== "rejected") return { kind: "not_rejected" };
    await upsertRejectReason(trx, ctx, {
      actionId: input.actionId,
      reason: input.reason,
      userId: input.userId,
      via: input.via,
      at: input.now,
    });
    await recordAudit(trx, ctx, {
      actionId: input.actionId,
      emailId: send.email_id,
      actor: input.userId,
      event: auditEvents.actionRejectReason,
      reasonCode: input.reason,
      data: { via: input.via },
      at: input.now,
    });
    return { kind: "saved" };
  });
}

/** The caller checks the owner role. Only a `send` with status `applied` and `applied_at` ≥ now − 7 days; once. */
export async function markSentMistake(
  db: Conn,
  ctx: TenantContext,
  input: { actionId: string; userId: string; via: ActionFeedbackVia; now: Date }
): Promise<MistakeResult> {
  return inTransaction(db, async (trx) => {
    const send = await lockSend(trx, ctx, input.actionId);
    if (send === undefined) return { kind: "not_found" };
    if (send.status !== "applied" || send.applied_at === null) return { kind: "not_sent" };
    if (send.applied_at.getTime() < input.now.getTime() - MISTAKE_WINDOW_MS) return { kind: "too_late" };
    const inserted = await insertMistakeOnce(trx, ctx, {
      actionId: input.actionId,
      userId: input.userId,
      via: input.via,
      at: input.now,
    });
    if (!inserted) return { kind: "already" };
    await recordAudit(trx, ctx, {
      actionId: input.actionId,
      emailId: send.email_id,
      actor: input.userId,
      event: auditEvents.actionMistake,
      data: { via: input.via },
      at: input.now,
    });
    return { kind: "saved" };
  });
}
