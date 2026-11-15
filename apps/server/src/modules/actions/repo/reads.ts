import { draftKinds, MAILBOX_ACTION_TYPES, moveTargets, sendLimitOfError, type ActionView } from "@ea/core";
import { sql } from "kysely";
import { z } from "zod";

import type { TenantContext } from "../../../platform/db";
import { emailIdOf } from "../anchor";

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
    .select(["email_id", "loop_id", sql<string>`payload->>'summary'`.as("summary")])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "save_summary")
    .where("email_id", "in", emailIds)
    .where(sql<string>`payload->>'summary'`, "is not", null)
    .execute();
  return new Map(rows.map((row) => [emailIdOf(row), row.summary]));
}
const moveTargetSchema = z.enum(moveTargets);
const sendKindSchema = z.enum(draftKinds);
// Oldest first per email. A row with an unknown type is left out; an unknown folder gives `null`.
export async function listActionsForEmails(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[],
  now: Date
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
      "loop_id",
      "type",
      "status",
      "reverses_action_id",
      "applied_at",
      "last_error",
      "next_attempt_at",
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
    // D11 (a): after the window the send waits for another reason, so it must not name the limit.
    if (
      row.status === "approved" &&
      sendLimitOfError(row.last_error) !== null &&
      row.next_attempt_at !== null &&
      row.next_attempt_at > now
    ) {
      view.waiting = "send_limit";
    }
    const emailId = emailIdOf(row);
    result.set(emailId, [...(result.get(emailId) ?? []), view]);
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
    .select(["email_id", "loop_id", sql<string | null>`payload->>'task'`.as("task")])
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
    const emailId = emailIdOf(row);
    if (row.task !== null && !tasks.has(emailId)) {
      tasks.set(emailId, row.task);
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
