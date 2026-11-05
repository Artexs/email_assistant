import { actionTypes, type ActionType } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

const actionTypeSchema = z.enum(actionTypes);

export interface PlannedActionInput {
  type: ActionType;
  payload: Record<string, string>;
  status: "ready" | "awaiting_approval" | "logged";
  idempotencyKey: string;
}

export interface CreatedAction {
  id: string;
  type: ActionType;
  status: string;
}

export interface ActionRow {
  id: string;
  type: string;
  status: string;
  payload: unknown;
}

// The status change of the email and these rows go in one transaction: the caller passes `trx`.
// A key that exists in this org inserts nothing; the result holds only the inserted rows.
export async function createPlanned(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  items: PlannedActionInput[]
): Promise<CreatedAction[]> {
  if (items.length === 0) {
    return [];
  }
  const rows = await db
    .insertInto("actions")
    .values(
      items.map((item) => ({
        org_id: ctx.orgId,
        email_id: emailId,
        type: item.type,
        payload: JSON.stringify(item.payload),
        status: item.status,
        idempotency_key: item.idempotencyKey,
      }))
    )
    .onConflict((oc) => oc.columns(["org_id", "idempotency_key"]).doNothing())
    .returning(["id", "type", "status"])
    .execute();
  return rows.map((row) => ({ id: row.id, type: actionTypeSchema.parse(row.type), status: row.status }));
}

// Oldest first.
export async function listActionsForEmail(db: DbOrTrx, ctx: TenantContext, emailId: string): Promise<ActionRow[]> {
  return db
    .selectFrom("actions")
    .select(["id", "type", "status", "payload"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

// Other modules read summaries only through this function: the actions module owns the payload.
export async function listSummaries(db: DbOrTrx, ctx: TenantContext, emailIds: string[]): Promise<Map<string, string>> {
  if (emailIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectFrom("actions")
    .select(["email_id", sql<string>`payload->>'summary'`.as("summary")])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "save_summary")
    .where("email_id", "in", emailIds)
    .where(sql<string>`payload->>'summary'`, "is not", null)
    .execute();
  return new Map(rows.map((row) => [row.email_id, row.summary]));
}
