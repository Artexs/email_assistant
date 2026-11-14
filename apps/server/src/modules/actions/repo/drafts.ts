import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

export interface DraftRow {
  id: string;
  email_id: string;
  status: string;
  payload: Record<string, unknown>;
  provider_result: Record<string, unknown> | null;
  created_at: Date;
  locked_at: Date | null;
}
function draftQuery(db: DbOrTrx, ctx: TenantContext, id: string) {
  return db
    .selectFrom("actions")
    .select(["id", "email_id", "status", "payload", "provider_result", "created_at", "locked_at"])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "create_draft")
    .where("reverses_action_id", "is", null)
    .where("id", "=", id);
}
function toDraftRow(row: Awaited<ReturnType<ReturnType<typeof draftQuery>["executeTakeFirstOrThrow"]>>): DraftRow {
  return {
    ...row,
    payload: row.payload as Record<string, unknown>,
    provider_result: row.provider_result as Record<string, unknown> | null,
  };
}
export async function lockDraft(trx: Transaction<DB>, ctx: TenantContext, id: string): Promise<DraftRow | undefined> {
  const row = await draftQuery(trx, ctx, id).forUpdate().executeTakeFirst();
  return row && toDraftRow(row);
}
export async function getDraft(db: DbOrTrx, ctx: TenantContext, id: string): Promise<DraftRow | undefined> {
  const row = await draftQuery(db, ctx, id).executeTakeFirst();
  return row && toDraftRow(row);
}
// D20: a reverse row of the draft exists = the draft was removed (or its removal is queued).
export async function draftHasReverse(db: DbOrTrx, ctx: TenantContext, draftId: string): Promise<boolean> {
  const row = await db
    .selectFrom("actions")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "create_draft")
    .where("reverses_action_id", "=", draftId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
// A resend shares the draft of the failed send (D18).
export async function listSendsOfDraft(
  db: DbOrTrx,
  ctx: TenantContext,
  draftId: string
): Promise<{ id: string; status: string }[]> {
  return db
    .selectFrom("actions")
    .select(["id", "status"])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("depends_on_action_id", "=", draftId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}
// A `ready` original draft whose send is dead: no draft is created for it (D13). The caller writes the audit row.
export async function expireReadyDraft(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  at: Date
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({ status: "expired", status_reason: "send_closed", locked_at: null, updated_at: at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "create_draft")
    .where("reverses_action_id", "is", null)
    .where("status", "=", "ready")
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
