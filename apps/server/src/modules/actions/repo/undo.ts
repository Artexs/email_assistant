import { MAILBOX_ACTION_TYPES, type ActionType } from "@ea/core";

import type { TenantContext } from "../../../platform/db";

import { actionTypeSchema, type DbOrTrx } from "./shared";

// The conditional update guards a double tap: only an `applied` original becomes `undone`. The caller writes the audit row.
export async function markUndone(
  trx: DbOrTrx,
  ctx: TenantContext,
  originalId: string,
  opts: { at: Date; reason: "undo" | "user_moved_back" | "sent" | "rejected" | "expired" }
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({ status: "undone", status_reason: opts.reason, updated_at: opts.at })
    .where("id", "=", originalId)
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "applied")
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
export interface UndoCandidate {
  id: string;
  type: ActionType;
  payload: Record<string, string>;
  status: string;
  appliedAt: Date | null;
  reverse: { id: string; status: string } | null;
}
// Locks the original rows of the mail (the same lock as lockLatestOriginalMove): Undo and the returned job run in turn.
export async function lockActionsForUndo(trx: DbOrTrx, ctx: TenantContext, emailId: string): Promise<UndoCandidate[]> {
  const originals = await trx
    .selectFrom("actions")
    .select(["id", "type", "payload", "status", "applied_at"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .where("reverses_action_id", "is", null)
    .where("type", "in", [...MAILBOX_ACTION_TYPES])
    .orderBy("created_at")
    .orderBy("id")
    .forUpdate()
    .execute();
  if (originals.length === 0) {
    return [];
  }
  const reverses = await trx
    .selectFrom("actions")
    .select(["id", "status", "reverses_action_id"])
    .where("org_id", "=", ctx.orgId)
    .where(
      "reverses_action_id",
      "in",
      originals.map((row) => row.id)
    )
    .execute();
  const reverseOf = new Map(reverses.map((row) => [row.reverses_action_id, { id: row.id, status: row.status }]));
  return originals.map((row) => ({
    id: row.id,
    type: actionTypeSchema.parse(row.type),
    payload: row.payload as Record<string, string>,
    status: row.status,
    appliedAt: row.applied_at,
    reverse: reverseOf.get(row.id) ?? null,
  }));
}
// The reverse row repeats the payload of the original, so readers know the folder. Null when a reverse exists.
export async function insertReverse(
  trx: DbOrTrx,
  ctx: TenantContext,
  original: { id: string; emailId: string; type: ActionType; payload: Record<string, string | number | null> }
): Promise<string | null> {
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      email_id: original.emailId,
      type: original.type,
      payload: JSON.stringify(original.payload),
      status: "ready",
      idempotency_key: `${original.id}:undo`,
      reverses_action_id: original.id,
    })
    .onConflict((oc) => oc.columns(["org_id", "idempotency_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  return row?.id ?? null;
}
// Newest original `move`, locked FOR UPDATE (M8); the reverse row comes from a second query.
export async function lockLatestOriginalMove(
  trx: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<{ id: string; status: string; reverseStatus: string | null } | undefined> {
  const move = await trx
    .selectFrom("actions")
    .select(["id", "status"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .where("type", "=", "move")
    .where("reverses_action_id", "is", null)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .forUpdate()
    .executeTakeFirst();
  if (!move) {
    return undefined;
  }
  const reverse = await trx
    .selectFrom("actions")
    .select("status")
    .where("org_id", "=", ctx.orgId)
    .where("reverses_action_id", "=", move.id)
    .executeTakeFirst();
  return { id: move.id, status: move.status, reverseStatus: reverse?.status ?? null };
}
