import { MAILBOX_ACTION_TYPES, moveTargets, type ActionView } from "@ea/core";
import { sql } from "kysely";
import { z } from "zod";

import type { TenantContext } from "../../../platform/db";

import { actionTypeSchema, type DbOrTrx } from "./shared";

export interface ActionRow {
  id: string;
  type: string;
  status: string;
  payload: unknown;
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
const moveTargetSchema = z.enum(moveTargets);
const sendKindSchema = z.enum(["delegation", "clarification", "reminder"]);
// Oldest first per email. A row with an unknown type is left out; an unknown folder gives `null`.
export async function listActionsForEmails(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, ActionView[]>> {
  const result = new Map<string, ActionView[]>();
  if (emailIds.length === 0) {
    return result;
  }
  const rows = await db
    .selectFrom("actions")
    .select([
      "id",
      "email_id",
      "type",
      "status",
      "reverses_action_id",
      "applied_at",
      sql<string | null>`payload->>'folder'`.as("folder"),
      sql<string | null>`payload->>'kind'`.as("kind"),
      sql<string | null>`payload->>'delegate_id'`.as("delegate_id"),
    ])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "in", [...emailIds])
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  for (const row of rows) {
    const type = actionTypeSchema.safeParse(row.type);
    if (!type.success) {
      continue;
    }
    const folder = moveTargetSchema.safeParse(row.folder);
    const kind = sendKindSchema.safeParse(row.kind);
    const view: ActionView = {
      id: row.id,
      type: type.data,
      status: row.status,
      folder: folder.success ? folder.data : null,
      reverse: row.reverses_action_id !== null,
      reversesActionId: row.reverses_action_id,
      appliedAt: row.applied_at,
      kind: kind.success ? kind.data : null,
      delegateId: row.delegate_id,
    };
    result.set(row.email_id, [...(result.get(row.email_id) ?? []), view]);
  }
  return result;
}
// The task of the original `create_draft` row per mail (a delegation or reminder draft); reverse rows are left out.
export async function listDraftTasks(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, string>> {
  if (emailIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectFrom("actions")
    .select(["email_id", sql<string | null>`payload->>'task'`.as("task")])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "in", [...emailIds])
    .where("type", "=", "create_draft")
    .where("reverses_action_id", "is", null)
    .where(sql<boolean>`payload->>'task' is not null`)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const tasks = new Map<string, string>();
  for (const row of rows) {
    if (row.task !== null && !tasks.has(row.email_id)) {
      tasks.set(row.email_id, row.task);
    }
  }
  return tasks;
}
// For /status: originals of mailbox types only. `applied` counts by `applied_at`, `failed` and `undone` by `updated_at`.
export async function countActionsSince(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { since: Date }
): Promise<{ applied: number; failed: number; undone: number }> {
  const rows = await db
    .selectFrom("actions")
    .select(["status", sql<string>`count(*)`.as("count")])
    .where("org_id", "=", ctx.orgId)
    .where("reverses_action_id", "is", null)
    .where("type", "in", [...MAILBOX_ACTION_TYPES])
    .where((eb) =>
      eb.or([
        eb.and([eb("status", "=", "applied"), eb("applied_at", ">=", opts.since)]),
        eb.and([eb("status", "in", ["failed", "undone"]), eb("updated_at", ">=", opts.since)]),
      ])
    )
    .groupBy("status")
    .execute();
  const count = (status: string) => Number(rows.find((row) => row.status === status)?.count ?? 0);
  return { applied: count("applied"), failed: count("failed"), undone: count("undone") };
}
