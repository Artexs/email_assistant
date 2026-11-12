import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

const delegationStatusSchema = z.enum(["drafted", "sent", "answered", "overdue", "done", "cancelled"]);
export type DelegationStatus = z.infer<typeof delegationStatusSchema>;

export interface DelegateRow {
  id: string;
  name: string;
  email: string;
  competence_tags: string[];
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

// null = the email exists in this organization (the unique index on org_id and email).
export async function insertDelegate(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { name: string; email: string; tags: string[] }
): Promise<string | null> {
  const row = await db
    .insertInto("delegates")
    .values({ org_id: ctx.orgId, name: input.name, email: input.email, competence_tags: input.tags })
    .onConflict((oc) => oc.columns(["org_id", "email"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  return row?.id ?? null;
}

// Name, id order.
export async function listDelegates(
  db: DbOrTrx,
  ctx: TenantContext,
  opts?: { activeOnly?: boolean }
): Promise<DelegateRow[]> {
  return db
    .selectFrom("delegates")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .$if(opts?.activeOnly === true, (qb) => qb.where("active", "=", true))
    .orderBy("name")
    .orderBy("id")
    .execute();
}

export async function getDelegate(db: DbOrTrx, ctx: TenantContext, id: string): Promise<DelegateRow | undefined> {
  return db.selectFrom("delegates").selectAll().where("org_id", "=", ctx.orgId).where("id", "=", id).executeTakeFirst();
}

export async function listDelegateNames(
  db: DbOrTrx,
  ctx: TenantContext,
  ids: readonly string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("delegates")
    .select(["id", "name"])
    .where("org_id", "=", ctx.orgId)
    .where("id", "in", [...ids])
    .execute();
  return new Map(rows.map((row) => [row.id, row.name]));
}

// For `isExternalSender` (D8). Lower case by the column check.
export async function listDelegateAddresses(
  db: DbOrTrx,
  ctx: TenantContext,
  opts?: { activeOnly?: boolean }
): Promise<string[]> {
  const rows = await db
    .selectFrom("delegates")
    .select("email")
    .where("org_id", "=", ctx.orgId)
    .$if(opts?.activeOnly === true, (qb) => qb.where("active", "=", true))
    .orderBy("email")
    .execute();
  return rows.map((row) => row.email);
}

// false = no such delegate, or it already has this state.
export async function setDelegateActive(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  active: boolean,
  at: Date
): Promise<boolean> {
  const result = await db
    .updateTable("delegates")
    .set({ active, updated_at: at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("active", "<>", active)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

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

function toDelegationRow<T extends { status: string }>(row: T): Omit<T, "status"> & { status: DelegationStatus } {
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
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function getDelegation(db: DbOrTrx, ctx: TenantContext, id: string): Promise<DelegationRow | undefined> {
  const row = await db
    .selectFrom("delegations")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .executeTakeFirst();
  return row && toDelegationRow(row);
}

// Lock order (D6): the delegation first, then its reminder sends.
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

export async function isDelegateActive(db: DbOrTrx, ctx: TenantContext, delegateId: string): Promise<boolean> {
  const row = await db
    .selectFrom("delegates")
    .select("active")
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", delegateId)
    .executeTakeFirst();
  return row?.active === true;
}

export async function findDelegationBySendAction(
  db: DbOrTrx,
  ctx: TenantContext,
  sendActionId: string
): Promise<DelegationRow | undefined> {
  const row = await db
    .selectFrom("delegations")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("send_action_id", "=", sendActionId)
    .executeTakeFirst();
  return row && toDelegationRow(row);
}

// D7. `ids` are normalized by the caller. The delegate's address is matched inside the query: another delegation in
// the same thread to another delegate never hides the right one. This module only reads `actions` here.
export async function findOpenDelegationByMessageIds(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  ids: readonly string[],
  fromAddress: string
): Promise<{ id: string; delegateId: string } | undefined> {
  if (ids.length === 0) return undefined;
  const idList = [...ids];
  const row = await db
    .selectFrom("delegations as d")
    .innerJoin("delegates as g", (join) => join.onRef("g.id", "=", "d.delegate_id").onRef("g.org_id", "=", "d.org_id"))
    .select(["d.id", "d.delegate_id"])
    .where("d.org_id", "=", ctx.orgId)
    .where("g.org_id", "=", ctx.orgId)
    .where("d.mailbox_id", "=", mailboxId)
    .where("d.status", "in", ["sent", "overdue"])
    .where(sql<string>`lower(g.email)`, "=", fromAddress.toLowerCase())
    .where((eb) =>
      eb.or([
        eb(sql<string>`d.sent_message_id`, "=", sql<string>`ANY(${idList}::text[])`),
        sql<boolean>`EXISTS (
          SELECT 1 FROM actions a
          WHERE a.org_id = d.org_id AND a.type = 'send' AND a.status = 'applied'
            AND a.payload->>'delegation_id' = d.id::text
            AND a.outgoing_message_id = ANY(${idList}::text[])
        )`,
      ])
    )
    .orderBy("d.created_at")
    .orderBy("d.id")
    .limit(1)
    .executeTakeFirst();
  return row && { id: row.id, delegateId: row.delegate_id };
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

// Also from `cancelled`: "Send again" after `outcome_unknown` (D6). `due_at` keeps a set value.
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
    .where("status", "in", ["drafted", "cancelled"])
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

export async function markDelegationCancelled(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  next: { reason: string; at: Date }
): Promise<boolean> {
  return updateDelegation(trx, ctx, id, ["drafted"], {
    status: "cancelled",
    status_reason: next.reason,
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

// `last_reminder_at` is set at planning, so a rejected reminder keeps the 3-day gap (D23).
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

// `sent` and `overdue` rows past `due_at`, oldest due first. `overdue` rows with 2 reminders sent are left out.
export async function listDueDelegations(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number }
): Promise<(DelegationRow & { delegate_active: boolean; delegate_email: string; delegate_name: string })[]> {
  const rows = await db
    .selectFrom("delegations as d")
    .innerJoin("delegates as g", (join) => join.onRef("g.id", "=", "d.delegate_id").onRef("g.org_id", "=", "d.org_id"))
    .selectAll("d")
    .select(["g.active as delegate_active", "g.email as delegate_email", "g.name as delegate_name"])
    .where("d.org_id", "=", ctx.orgId)
    .where("g.org_id", "=", ctx.orgId)
    .where("d.mailbox_id", "=", mailboxId)
    .where("d.status", "in", ["sent", "overdue"])
    // An overdue row with both reminders sent gets no more (D23): it would only fill the batch.
    .where((eb) => eb.not(eb.and([eb("d.status", "=", "overdue"), eb("d.reminders_sent", ">=", 2)])))
    .where("d.due_at", "<", opts.now)
    .orderBy("d.due_at")
    .orderBy("d.id")
    .limit(opts.limit)
    .execute();
  return rows.map(toDelegationRow);
}

// Reminder sends that have not ended (a read only: the `actions` module writes them).
export async function countPendingReminderSends(
  db: DbOrTrx,
  ctx: TenantContext,
  delegationId: string
): Promise<number> {
  const row = await db
    .selectFrom("actions")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "in", ["awaiting_approval", "approved", "applying"])
    .where(sql<string>`payload->>'delegation_id'`, "=", delegationId)
    .where(sql<boolean>`jsonb_exists(payload, 'reminder')`)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export async function countOpenDelegations(
  db: DbOrTrx,
  ctx: TenantContext
): Promise<{ open: number; overdue: number }> {
  const rows = await db
    .selectFrom("delegations")
    .select(["status", (eb) => eb.fn.countAll<string>().as("count")])
    .where("org_id", "=", ctx.orgId)
    .where("status", "in", ["sent", "overdue"])
    .groupBy("status")
    .execute();
  const count = (status: string) => Number(rows.find((row) => row.status === status)?.count ?? 0);
  return { open: count("sent"), overdue: count("overdue") };
}

type WithNames = DelegationRow & { delegate_name: string; subject: string | null };

function namedQuery(db: DbOrTrx, ctx: TenantContext) {
  return db
    .selectFrom("delegations as d")
    .innerJoin("delegates as g", (join) => join.onRef("g.id", "=", "d.delegate_id").onRef("g.org_id", "=", "d.org_id"))
    .leftJoin("emails as e", (join) => join.onRef("e.id", "=", "d.email_id").onRef("e.org_id", "=", "d.org_id"))
    .selectAll("d")
    .select(["g.name as delegate_name", "e.subject"])
    .where("d.org_id", "=", ctx.orgId)
    .where("g.org_id", "=", ctx.orgId);
}

// Newest first.
export async function listDelegations(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { status?: DelegationStatus; limit: number }
): Promise<WithNames[]> {
  const status = opts.status;
  const rows = await namedQuery(db, ctx)
    .$if(status !== undefined, (qb) => qb.where("d.status", "=", status as DelegationStatus))
    .orderBy("d.created_at", "desc")
    .orderBy("d.id")
    .limit(opts.limit)
    .execute();
  return rows.map(toDelegationRow);
}

// Oldest answer first.
export async function listAnsweredUnnotified(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number }
): Promise<WithNames[]> {
  const rows = await namedQuery(db, ctx)
    .where("d.status", "=", "answered")
    .where("d.answered_notified_at", "is", null)
    .orderBy("d.answered_at")
    .orderBy("d.id")
    .limit(opts.limit)
    .execute();
  return rows.map(toDelegationRow);
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

export interface LatestDelegationRow {
  status: DelegationStatus;
  due_at: Date | null;
  delegate_name: string | null;
}

// The newest delegation per mail (created_at desc, id desc) with the delegate name, in chunks of 500 ids.
export async function listLatestDelegationsByEmailIds(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, LatestDelegationRow>> {
  const out = new Map<string, LatestDelegationRow>();
  for (let i = 0; i < emailIds.length; i += 500) {
    const rows = await db
      .selectFrom("delegations as d")
      .leftJoin("delegates as g", (join) => join.onRef("g.id", "=", "d.delegate_id").onRef("g.org_id", "=", "d.org_id"))
      .distinctOn("d.email_id")
      .select(["d.email_id", "d.status", "d.due_at", "g.name as delegate_name"])
      .where("d.org_id", "=", ctx.orgId)
      .where("d.email_id", "in", emailIds.slice(i, i + 500))
      .orderBy("d.email_id")
      .orderBy("d.created_at", "desc")
      .orderBy("d.id", "desc")
      .execute();
    for (const row of rows) {
      out.set(row.email_id, {
        status: delegationStatusSchema.parse(row.status),
        due_at: row.due_at,
        delegate_name: row.delegate_name,
      });
    }
  }
  return out;
}

const RETENTION_BATCH = 1000;

// Retention (A23): the task text goes 90 days after the last change (this covers 90 days after `done`).
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
