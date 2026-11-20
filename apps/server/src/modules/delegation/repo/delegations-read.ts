import { normalizeAddress } from "@ea/core";
import { sql } from "kysely";

import { normalizedAddress, type TenantContext } from "../../../platform/db";

import {
  MAX_REMINDER_SENDS,
  delegationStatusSchema,
  toDelegationRow,
  type DelegationRow,
  type DelegationSource,
  type DelegationStatus,
} from "./delegations";
import type { DbOrTrx } from "./shared";

// The Delegate command of a mail asks two questions about the delegations of one mail.
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
// `ids` are normalized by the caller. The delegate's address is matched inside the query: another delegation in
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
    .where(normalizedAddress("g.email"), "=", normalizeAddress(fromAddress))
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
// Is a delegation of the mailbox out (`sent` or `overdue`) for a mail of this thread? The thread key is the
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
    // An overdue row with both reminders sent gets no more: it would only fill the batch.
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
// The open delegations (`sent`, `overdue`) with a due date before `dueBefore`, oldest due first: the ⏳ lines of the brief.
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
// One page of the delegation list: `limit` rows after the cursor, in the states `statuses`. The caller asks for one
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
