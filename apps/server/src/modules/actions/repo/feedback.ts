import type { RejectReason } from "@ea/core";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

export type ActionFeedbackKind = "reject_reason" | "mistake";
export type ActionFeedbackVia = "telegram" | "web" | "cli";

export interface ActionFeedbackRow {
  actionId: string;
  kind: ActionFeedbackKind;
  reason: RejectReason | null;
  userId: string | null;
  via: ActionFeedbackVia;
  createdAt: Date;
  updatedAt: Date;
}

interface FeedbackInput {
  actionId: string;
  userId: string;
  via: ActionFeedbackVia;
  at: Date;
}

// One reason per rejected send: a later reason replaces the earlier one (D21). The unique key is (org_id, action_id, kind).
export async function upsertRejectReason(
  db: DbOrTrx,
  ctx: TenantContext,
  input: FeedbackInput & { reason: RejectReason }
): Promise<void> {
  await db
    .insertInto("action_feedback")
    .values({
      org_id: ctx.orgId,
      action_id: input.actionId,
      kind: "reject_reason",
      reason: input.reason,
      user_id: input.userId,
      via: input.via,
      created_at: input.at,
      updated_at: input.at,
    })
    .onConflict((oc) =>
      oc.columns(["org_id", "action_id", "kind"]).doUpdateSet((eb) => ({
        reason: eb.ref("excluded.reason"),
        user_id: eb.ref("excluded.user_id"),
        via: eb.ref("excluded.via"),
        updated_at: eb.ref("excluded.updated_at"),
      }))
    )
    .execute();
}

// The mark is set once; true when this call wrote the row.
export async function insertMistakeOnce(db: DbOrTrx, ctx: TenantContext, input: FeedbackInput): Promise<boolean> {
  const result = await db
    .insertInto("action_feedback")
    .values({
      org_id: ctx.orgId,
      action_id: input.actionId,
      kind: "mistake",
      reason: null,
      user_id: input.userId,
      via: input.via,
      created_at: input.at,
      updated_at: input.at,
    })
    .onConflict((oc) => oc.columns(["org_id", "action_id", "kind"]).doNothing())
    .executeTakeFirst();
  return result.numInsertedOrUpdatedRows !== undefined && result.numInsertedOrUpdatedRows > 0n;
}

export async function getActionFeedback(
  db: DbOrTrx,
  ctx: TenantContext,
  actionId: string,
  kind: ActionFeedbackKind
): Promise<ActionFeedbackRow | undefined> {
  const row = await db
    .selectFrom("action_feedback")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("action_id", "=", actionId)
    .where("kind", "=", kind)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  return {
    actionId: row.action_id,
    kind: row.kind as ActionFeedbackKind,
    reason: row.reason as RejectReason | null,
    userId: row.user_id,
    via: row.via as ActionFeedbackVia,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
