import { DELEGATION_REMINDER_LIMIT } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, TenantContext } from "../../../platform/db";
import type { PayloadKeepRule } from "../../actions";

import type { DbOrTrx } from "./shared";

export const delegationStatusSchema = z.enum(["drafted", "sent", "answered", "overdue", "done", "cancelled"]);
export type DelegationStatus = z.infer<typeof delegationStatusSchema>;
export type DelegationSource = "triage" | "button";
// The reason of a cancel by the user. It is final.
export const USER_CANCELLED = "user_cancelled";
// The chaser sends at most this many reminders for one delegation.
export const MAX_REMINDER_SENDS = DELEGATION_REMINDER_LIMIT;
// A delegation is open while the chaser can still act on it: the draft waits, the task is out, or it is overdue with a
// reminder left. Retention keeps the task text and the applied draft payload of an open delegation.
export const openDelegationFilter = sql<boolean>`(
  delegations.status in ('drafted', 'sent')
  or (delegations.status = 'overdue' and delegations.reminders_sent < ${sql.lit(MAX_REMINDER_SENDS)})
)`;
// The keep rule of the actions retention clear: the row is the applied draft of an open delegation, and the
// chaser still reads the language and the due date from its payload. `retention.ts` passes it.
export const isOpenDelegationDraft: PayloadKeepRule = (eb, ctx) =>
  eb.exists(
    eb
      .selectFrom("delegations")
      .select("delegations.id")
      .whereRef("delegations.draft_action_id", "=", "actions.id")
      .where("delegations.org_id", "=", ctx.orgId)
      .where(openDelegationFilter)
  );
export interface DelegationRow {
  id: string;
  mailbox_id: string;
  email_id: string;
  delegate_id: string;
  draft_action_id: string;
  send_action_id: string;
  task_summary: string;
  due_at: Date | null;
  status: DelegationStatus;
  status_reason: string | null;
  sent_message_id: string | null;
  sent_at: Date | null;
  last_reminder_at: Date | null;
  reminders_sent: number;
  answered_email_id: string | null;
  answered_at: Date | null;
  answered_notified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
export function toDelegationRow<T extends { status: string }>(
  row: T
): Omit<T, "status"> & { status: DelegationStatus } {
  return { ...row, status: delegationStatusSchema.parse(row.status) };
}
export async function insertDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: {
    mailboxId: string;
    emailId: string;
    delegateId: string;
    draftActionId: string;
    sendActionId: string;
    taskSummary: string;
    dueAt: Date | null;
    createdAt: Date;
    // `triage` (the default of the column) or `button` (the Delegate command).
    source?: DelegationSource;
  }
): Promise<string> {
  const row = await trx
    .insertInto("delegations")
    .values({
      org_id: ctx.orgId,
      mailbox_id: input.mailboxId,
      email_id: input.emailId,
      delegate_id: input.delegateId,
      draft_action_id: input.draftActionId,
      send_action_id: input.sendActionId,
      task_summary: input.taskSummary,
      due_at: input.dueAt,
      created_at: input.createdAt,
      updated_at: input.createdAt,
      ...(input.source === undefined ? {} : { source: input.source }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
// Lock order: the delegation first, then its reminder sends.
export async function lockDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string
): Promise<DelegationRow | undefined> {
  const row = await trx
    .selectFrom("delegations")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  return row && toDelegationRow(row);
}
async function updateDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  from: readonly DelegationStatus[],
  set: Record<string, unknown> & { updated_at: Date }
): Promise<boolean> {
  const result = await trx
    .updateTable("delegations")
    .set(set)
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("status", "in", [...from])
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
// Also from `cancelled`: "Send again" after `outcome_unknown`. `due_at` keeps a set value. A delegation that the user cancelled
// (`user_cancelled`) stays cancelled: no send reopens it.
export async function markDelegationSent(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  next: { sentMessageId: string; sentAt: Date; dueAtWhenNull: Date }
): Promise<boolean> {
  const result = await trx
    .updateTable("delegations")
    .set((eb) => ({
      status: "sent",
      status_reason: null,
      sent_message_id: next.sentMessageId,
      sent_at: next.sentAt,
      due_at: eb.fn.coalesce("due_at", eb.val(next.dueAtWhenNull)),
      updated_at: next.sentAt,
    }))
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where((eb) =>
      eb.or([
        eb("status", "=", "drafted"),
        eb.and([eb("status", "=", "cancelled"), eb("status_reason", "is distinct from", USER_CANCELLED)]),
      ])
    )
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
export async function markDelegationAnswered(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  next: { answeredEmailId: string; at: Date }
): Promise<boolean> {
  return updateDelegation(trx, ctx, id, ["sent", "overdue"], {
    status: "answered",
    answered_email_id: next.answeredEmailId,
    answered_at: next.at,
    updated_at: next.at,
  });
}
export async function markDelegationOverdue(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  at: Date
): Promise<boolean> {
  return updateDelegation(trx, ctx, id, ["sent"], { status: "overdue", updated_at: at });
}
// Only a `drafted` delegation is cancelled by the system. The user's own cancel (`user_cancelled`) also takes `sent`
// and `overdue`; `answered`, `done` and `cancelled` never change.
export async function markDelegationCancelled(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  next: { reason: string; at: Date }
): Promise<boolean> {
  const from: readonly DelegationStatus[] =
    next.reason === USER_CANCELLED ? ["drafted", "sent", "overdue"] : ["drafted"];
  return updateDelegation(trx, ctx, id, from, {
    status: "cancelled",
    status_reason: next.reason,
    updated_at: next.at,
  });
}
// A panel edit replaced the waiting send and its draft: the delegation points at the new rows and the delegate of the new version.
// Only a `drafted` delegation takes it; the caller holds the delegation lock.
export async function moveDelegationToVersion(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  next: { draftActionId: string; sendActionId: string; delegateId: string; at: Date }
): Promise<boolean> {
  return updateDelegation(trx, ctx, id, ["drafted"], {
    draft_action_id: next.draftActionId,
    send_action_id: next.sendActionId,
    delegate_id: next.delegateId,
    updated_at: next.at,
  });
}
export async function markDelegationDone(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  at: Date
): Promise<boolean> {
  return updateDelegation(trx, ctx, id, ["answered", "overdue"], { status: "done", updated_at: at });
}
// `last_reminder_at` is set at planning, so a rejected reminder keeps the 3-day gap.
export async function markReminderPlanned(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  at: Date
): Promise<boolean> {
  return updateDelegation(trx, ctx, id, ["sent", "overdue"], { last_reminder_at: at, updated_at: at });
}
export async function bumpReminder(trx: Transaction<DB>, ctx: TenantContext, id: string, at: Date): Promise<boolean> {
  const result = await trx
    .updateTable("delegations")
    .set((eb) => ({ reminders_sent: eb("reminders_sent", "+", 1), updated_at: at }))
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("status", "in", ["sent", "overdue"])
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
export async function markAnsweredNotified(db: DbOrTrx, ctx: TenantContext, id: string, at: Date): Promise<boolean> {
  const result = await db
    .updateTable("delegations")
    .set({ answered_notified_at: at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("answered_notified_at", "is", null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
const RETENTION_BATCH = 1000;
// Retention: the task text of a delegation that is not open goes 90 days after the last change (this covers 90 days
// after `done`). An open delegation keeps its text until it closes: its reminders read it, and its due date can be far ahead.
// Batches by id; a locked row waits for a later day. A repeat call changes nothing.
export async function clearDelegationTasks(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("delegations")
      .set({ task_summary: "[removed]" })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("delegations")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("updated_at", "<", opts.before)
          .where("task_summary", "<>", "[removed]")
          .where(sql<boolean>`not ${openDelegationFilter}`)
          .orderBy("id")
          .limit(batch)
          .forUpdate()
          .skipLocked()
      )
      .executeTakeFirstOrThrow();
    const changed = Number(result.numUpdatedRows);
    total += changed;
    if (changed === 0) return total;
  }
}
