import { DELEGATION_REMINDER_LIMIT } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import type { PayloadKeepRule } from "../actions";

type DbOrTrx = Db | Transaction<DB>;

const delegationStatusSchema = z.enum(["drafted", "sent", "answered", "overdue", "done", "cancelled"]);
export type DelegationStatus = z.infer<typeof delegationStatusSchema>;
export type DelegationSource = "triage" | "button";

// The reason of a cancel by the user (F102 stage 15). It is final.
export const USER_CANCELLED = "user_cancelled";

// The chaser sends at most this many reminders for one delegation (D23).
export const MAX_REMINDER_SENDS = DELEGATION_REMINDER_LIMIT;

// A delegation is open while the chaser can still act on it: the draft waits, the task is out, or it is overdue with a
// reminder left. Retention keeps the task text and the applied draft payload of an open delegation (A23, F083).
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

// Name, id order. `activeFirst` puts the active delegates first (the panel list); `limit` caps the rows.
export async function listDelegates(
  db: DbOrTrx,
  ctx: TenantContext,
  opts?: { activeOnly?: boolean; activeFirst?: boolean; limit?: number }
): Promise<DelegateRow[]> {
  return db
    .selectFrom("delegates")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .$if(opts?.activeOnly === true, (qb) => qb.where("active", "=", true))
    .$if(opts?.activeFirst === true, (qb) => qb.orderBy("active", "desc"))
    .orderBy("name")
    .orderBy("id")
    .$if(opts?.limit !== undefined, (qb) => qb.limit(opts?.limit ?? 0))
    .execute();
}

export async function getDelegate(db: DbOrTrx, ctx: TenantContext, id: string): Promise<DelegateRow | undefined> {
  return db.selectFrom("delegates").selectAll().where("org_id", "=", ctx.orgId).where("id", "=", id).executeTakeFirst();
}

// The row locked for the rest of the transaction: two changes of one delegate run one after the other, so each sees the other's result.
export async function lockDelegate(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string
): Promise<DelegateRow | undefined> {
  return trx
    .selectFrom("delegates")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
}

// The address never changes (F102 D10): the patch has no `email`.
export async function updateDelegateFields(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  patch: { name?: string; tags?: string[]; active?: boolean },
  at: Date
): Promise<void> {
  await trx
    .updateTable("delegates")
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.tags === undefined ? {} : { competence_tags: patch.tags }),
      ...(patch.active === undefined ? {} : { active: patch.active }),
      updated_at: at,
    })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .execute();
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

// The competence tags of delegates (F110 stage 16): words the organization wrote, never mail text.
export async function listDelegateTags(
  db: DbOrTrx,
  ctx: TenantContext,
  ids: readonly string[]
): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("delegates")
    .select(["id", "competence_tags"])
    .where("org_id", "=", ctx.orgId)
    .where("id", "in", [...ids])
    .execute();
  return new Map(rows.map((row) => [row.id, row.competence_tags]));
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
    // `triage` (the default of the column) or `button` (the Delegate command, F116).
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

// The Delegate command of a mail (F116 stage 16) asks two questions about the delegations of one mail.
// A delegation that still waits for the delegate: the draft waits, the task is out, or it is overdue.
export async function findOpenDelegationOfEmail(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<string | undefined> {
  const row = await db
    .selectFrom("delegations")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .where("status", "in", ["drafted", "sent", "overdue"])
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.id;
}

// How many delegations of this source the mail has had, in any state (the attempt number of the Delegate keys).
export async function countDelegationsOfEmail(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  source: DelegationSource
): Promise<number> {
  const row = await db
    .selectFrom("delegations")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .where("source", "=", source)
    .executeTakeFirstOrThrow();
  return Number(row.n);
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

// F116 (G10): is a delegation of the mailbox out (`sent` or `overdue`) for a mail of this thread? The thread key is the
// one of the delegated incoming mail. The user's own mail in that thread belongs to the delegation chaser. A read only.
export async function hasOpenDelegationInThread(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  threadKey: string
): Promise<boolean> {
  const row = await db
    .selectFrom("delegations as d")
    .innerJoin("emails as e", (join) => join.onRef("e.id", "=", "d.email_id").onRef("e.org_id", "=", "d.org_id"))
    .select("d.id")
    .where("d.org_id", "=", ctx.orgId)
    .where("e.org_id", "=", ctx.orgId)
    .where("d.mailbox_id", "=", mailboxId)
    .where("d.status", "in", ["sent", "overdue"])
    .where("e.thread_key", "=", threadKey)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
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
// (`user_cancelled`, F102 stage 15) stays cancelled: no send reopens it.
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

// Only a `drafted` delegation is cancelled by the system. The user's own cancel (`user_cancelled`, F102 stage 15) also takes `sent`
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

// A panel edit replaced the waiting send and its draft (F102 ticket): the delegation points at the new rows and the delegate of the new version.
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
    .where((eb) => eb.not(eb.and([eb("d.status", "=", "overdue"), eb("d.reminders_sent", ">=", MAX_REMINDER_SENDS)])))
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

export interface BriefDelegationRow {
  id: string;
  delegate_name: string;
  subject: string | null;
  sent_at: Date;
  due_at: Date;
  status: "sent" | "overdue";
}

// The open delegations (`sent`, `overdue`) with a due date before `dueBefore`, oldest due first: the ⏳ lines of the brief (F116 stage 18).
// `total` counts all of them, `rows` holds at most `limit`. Only the organization of `ctx` and the given mailboxes.
export async function listDelegationsDueBy(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxIds: readonly string[],
  opts: { dueBefore: Date; limit: number }
): Promise<{ rows: BriefDelegationRow[]; total: number }> {
  if (mailboxIds.length === 0) return { rows: [], total: 0 };
  const scope = () =>
    db
      .selectFrom("delegations as d")
      .innerJoin("delegates as g", (join) =>
        join.onRef("g.id", "=", "d.delegate_id").onRef("g.org_id", "=", "d.org_id")
      )
      .where("d.org_id", "=", ctx.orgId)
      .where("d.mailbox_id", "in", [...mailboxIds])
      .where("d.status", "in", ["sent", "overdue"])
      .where("d.due_at", "<", opts.dueBefore);
  const [rows, count] = await Promise.all([
    scope()
      .leftJoin("emails as e", (join) => join.onRef("e.id", "=", "d.email_id").onRef("e.org_id", "=", "d.org_id"))
      .select(["d.id", "g.name as delegate_name", "e.subject", "d.sent_at", "d.created_at", "d.due_at", "d.status"])
      .orderBy("d.due_at")
      .orderBy("d.id")
      .limit(opts.limit)
      .execute(),
    scope()
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow(),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      delegate_name: row.delegate_name,
      subject: row.subject,
      sent_at: row.sent_at ?? row.created_at,
      due_at: row.due_at as Date,
      status: row.status === "overdue" ? "overdue" : "sent",
    })),
    total: Number(count.n),
  };
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

// Retention (A23): the task text of a delegation that is not open goes 90 days after the last change (this covers 90 days
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

// The cursor of the delegation list: the `created_at` of the last row as text with microseconds (a JS date holds milliseconds
// only), and its id. The list order is `created_at` desc, then `id`.
export interface DelegationPageCursor {
  createdAtKey: string;
  id: string;
}

export type DelegationPageRow = Omit<WithNames, "delegate_name"> & {
  delegate_name: string;
  delegate_email: string;
  delegate_active: boolean;
  created_at_key: string;
  reminder_waiting: boolean;
};

// One page of the delegation list (F102 stage 15): `limit` rows after the cursor, in the states `statuses`. The caller asks for one
// row more than it shows. Every table in the query is filtered by `org_id`.
export async function listDelegationPage(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { statuses: readonly DelegationStatus[]; cursor?: DelegationPageCursor; limit: number }
): Promise<DelegationPageRow[]> {
  const cursor = opts.cursor;
  const rows = await namedQuery(db, ctx)
    .select([
      "g.email as delegate_email",
      "g.active as delegate_active",
      sql<string>`to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("created_at_key"),
      (eb) =>
        eb
          .exists(
            eb
              .selectFrom("actions as a")
              .select("a.id")
              .where("a.org_id", "=", ctx.orgId)
              .where("a.type", "=", "send")
              .where("a.status", "in", ["awaiting_approval", "approved", "applying"])
              .where(sql<string>`a.payload->>'delegation_id'`, "=", sql<string>`d.id::text`)
              .where(sql<boolean>`jsonb_exists(a.payload, 'reminder')`)
          )
          .$castTo<boolean>()
          .as("reminder_waiting"),
    ])
    .where("d.status", "in", [...opts.statuses])
    .$if(cursor !== undefined, (qb) =>
      qb.where(
        sql<boolean>`(d.created_at < ${cursor?.createdAtKey}::timestamptz
          or (d.created_at = ${cursor?.createdAtKey}::timestamptz and d.id > ${cursor?.id}::uuid))`
      )
    )
    .orderBy("d.created_at", "desc")
    .orderBy("d.id")
    .limit(opts.limit)
    .execute();
  return rows.map(toDelegationRow);
}
