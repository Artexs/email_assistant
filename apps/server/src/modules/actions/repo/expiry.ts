import { MAILBOX_ACTION_TYPES, type ActionType, type ExpireFilter } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import { CLAIM_MAX_AGE_MS } from "./claims";
import { actionTypeSchema, type DbOrTrx } from "./shared";

// D21. The caller writes the `action.expired` audit rows.
export async function expireStaleReady(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; staleBefore: Date }
): Promise<{ id: string; emailId: string; type: ActionType }[]> {
  const rows = await db
    .updateTable("actions")
    .set({ status: "expired", status_reason: "stale", updated_at: opts.now })
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "ready")
    .where("reverses_action_id", "is", null)
    .where("type", "in", [...MAILBOX_ACTION_TYPES])
    .where("created_at", "<", new Date(opts.now.getTime() - CLAIM_MAX_AGE_MS))
    .where((eb) => eb.or([eb("locked_at", "is", null), eb("locked_at", "<", opts.staleBefore)]))
    .where("email_id", "in", (eb) =>
      eb.selectFrom("emails").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", mailboxId)
    )
    .returning(["id", "email_id", "type"])
    .execute();
  return rows.map((row) => ({ id: row.id, emailId: row.email_id, type: actionTypeSchema.parse(row.type) }));
}
// `ready` originals of the mailbox-changing types. Above 0 after an expire only while a committer run holds a row.
export async function countReadyOriginals(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<number> {
  const row = await db
    .selectFrom("actions")
    .select(sql<string>`count(*)`.as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "ready")
    .where("reverses_action_id", "is", null)
    .where("type", "in", [...MAILBOX_ACTION_TYPES])
    .where("email_id", "in", (eb) =>
      eb.selectFrom("emails").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", mailboxId)
    )
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// A row that a committer run holds now (`locked_at` >= `staleBefore`) stays: it ends as `applied` and keeps its Undo.
// The caller writes the `action.expired` audit rows.
export async function expireReadyOriginals(
  trx: DbOrTrx,
  ctx: TenantContext,
  filter: ExpireFilter,
  opts: { now: Date; staleBefore: Date; reason: "policy_changed" | "undo" | "manual" }
): Promise<{ id: string; emailId: string; type: ActionType }[]> {
  if (filter.types.length === 0) {
    return [];
  }
  const latestCategory = sql<string>`(
    SELECT t.category FROM triage_results t
    WHERE t.org_id = actions.org_id AND t.email_id = actions.email_id
    ORDER BY t.created_at DESC, t.id DESC LIMIT 1
  )`;
  const { category, emailId } = filter;
  const rows = await trx
    .updateTable("actions")
    .set({ status: "expired", status_reason: opts.reason, updated_at: opts.now })
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "ready")
    .where("reverses_action_id", "is", null)
    .where("type", "in", [...filter.types])
    .where((eb) => eb.or([eb("locked_at", "is", null), eb("locked_at", "<", opts.staleBefore)]))
    .where("email_id", "in", (eb) =>
      eb.selectFrom("emails").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", filter.mailboxId)
    )
    .$if(emailId !== undefined, (qb) => qb.where("email_id", "=", emailId as string))
    .$if(category !== undefined && "is" in category, (qb) =>
      qb.where(latestCategory, "=", (category as { is: string }).is)
    )
    .$if(category !== undefined && "not" in category, (qb) =>
      qb.where(latestCategory, "<>", (category as { not: string }).not)
    )
    .returning(["id", "email_id", "type"])
    .execute();
  return rows.map((row) => ({ id: row.id, emailId: row.email_id, type: actionTypeSchema.parse(row.type) }));
}
