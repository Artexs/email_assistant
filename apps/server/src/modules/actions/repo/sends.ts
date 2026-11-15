import type { RecentSend } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";
import { ActionAnchorError, anchorOfRow, emailIdOf } from "../anchor";

import type { DbOrTrx } from "./shared";

export interface SendRow {
  id: string;
  email_id: string;
  status: string;
  status_reason: string | null;
  payload: Record<string, unknown>;
  depends_on_action_id: string | null;
  notified_at: Date | null;
  approved_by: string | null;
  approved_at: Date | null;
  approved_via: string | null;
  outgoing_message_id: string | null;
  provider_result: Record<string, unknown> | null;
  applied_at: Date | null;
  created_at: Date;
  updated_at: Date;
  attempts: number;
  last_error: string | null;
  locked_at: Date | null;
  email: {
    mailbox_id: string;
    subject: string | null;
    from_address: string | null;
    message_id_header: string | null;
    received_at: Date;
    references_header: string | null;
    in_reply_to: string | null;
    body_text: string | null;
  };
}
// Mail sends only: the readers of cards, lists and notices need the mail behind the send. A loop send (a follow-up) has none;
// those readers get it with open loops stage 11. The committer side reads both kinds with `lockAnySend` and `getAnySend`.
export function sendBase(db: DbOrTrx, ctx: TenantContext) {
  return db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select([
      "actions.id",
      "actions.email_id",
      "actions.loop_id",
      "actions.status",
      "actions.status_reason",
      "actions.payload",
      "actions.depends_on_action_id",
      "actions.notified_at",
      "actions.approved_by",
      "actions.approved_at",
      "actions.approved_via",
      "actions.outgoing_message_id",
      "actions.provider_result",
      "actions.applied_at",
      "actions.created_at",
      "actions.updated_at",
      "actions.attempts",
      "actions.last_error",
      "actions.locked_at",
      "emails.mailbox_id",
      "emails.subject",
      "emails.from_address",
      "emails.message_id_header",
      "emails.received_at",
      "emails.references_header",
      "emails.in_reply_to",
      "emails.body_text",
    ])
    .where("actions.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("actions.email_id", "is not", null)
    .where("actions.type", "=", "send");
}
function sendQuery(db: DbOrTrx, ctx: TenantContext, id: string) {
  return sendBase(db, ctx).where("actions.id", "=", id);
}
type SendQueryRow = NonNullable<Awaited<ReturnType<ReturnType<typeof sendQuery>["executeTakeFirst"]>>>;
export function toSendRow(row: SendQueryRow): SendRow {
  const {
    mailbox_id,
    subject,
    from_address,
    message_id_header,
    received_at,
    references_header,
    in_reply_to,
    body_text,
  } = row;
  return {
    id: row.id,
    email_id: emailIdOf(row),
    status: row.status,
    status_reason: row.status_reason,
    payload: row.payload as Record<string, unknown>,
    depends_on_action_id: row.depends_on_action_id,
    notified_at: row.notified_at,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    approved_via: row.approved_via,
    outgoing_message_id: row.outgoing_message_id,
    provider_result: row.provider_result as Record<string, unknown> | null,
    applied_at: row.applied_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    attempts: row.attempts,
    last_error: row.last_error,
    locked_at: row.locked_at,
    email: {
      mailbox_id,
      subject,
      from_address,
      message_id_header,
      received_at,
      references_header,
      in_reply_to,
      body_text,
    },
  };
}
// A send of a mail or of a loop, with the few fields that the close and fail paths of the committer side need.
// `mailbox_id` comes from the mail, or from the loop for a follow-up (`open_loops.mailbox_id`).
export interface AnySendRow {
  id: string;
  email_id: string | null;
  loop_id: string | null;
  mailbox_id: string;
  status: string;
  status_reason: string | null;
  payload: Record<string, unknown>;
  depends_on_action_id: string | null;
  locked_at: Date | null;
}
function anySendQuery(db: DbOrTrx, ctx: TenantContext, id: string) {
  return db
    .selectFrom("actions")
    .leftJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .leftJoin("open_loops", (join) =>
      join.onRef("open_loops.id", "=", "actions.loop_id").onRef("open_loops.org_id", "=", "actions.org_id")
    )
    .select([
      "actions.id",
      "actions.email_id",
      "actions.loop_id",
      "actions.status",
      "actions.status_reason",
      "actions.payload",
      "actions.depends_on_action_id",
      "actions.locked_at",
      sql<string | null>`coalesce(emails.mailbox_id, open_loops.mailbox_id)`.as("mailbox_id"),
    ])
    .where("actions.org_id", "=", ctx.orgId)
    .where("actions.type", "=", "send")
    .where("actions.id", "=", id);
}
function toAnySendRow(
  row: Awaited<ReturnType<ReturnType<typeof anySendQuery>["executeTakeFirstOrThrow"]>>
): AnySendRow {
  anchorOfRow(row); // exactly one anchor (the database CHECK says so too)
  if (row.mailbox_id === null) throw new ActionAnchorError("invalid_anchor");
  return { ...row, mailbox_id: row.mailbox_id, payload: row.payload as Record<string, unknown> };
}
// FOR UPDATE of the action row only. Lock order: the loop first (a loop send), then the send (D15).
export async function lockAnySend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string
): Promise<AnySendRow | undefined> {
  const row = await anySendQuery(trx, ctx, id).forUpdate("actions").executeTakeFirst();
  return row && toAnySendRow(row);
}
export async function getAnySend(db: DbOrTrx, ctx: TenantContext, id: string): Promise<AnySendRow | undefined> {
  const row = await anySendQuery(db, ctx, id).executeTakeFirst();
  return row && toAnySendRow(row);
}
// FOR UPDATE of the action row only (the mail row stays unlocked: the lock order of S3, D6).
export async function lockSend(trx: Transaction<DB>, ctx: TenantContext, id: string): Promise<SendRow | undefined> {
  const row = await sendQuery(trx, ctx, id).forUpdate("actions").executeTakeFirst();
  return row && toSendRow(row);
}
export async function getSend(db: DbOrTrx, ctx: TenantContext, id: string): Promise<SendRow | undefined> {
  const row = await sendQuery(db, ctx, id).executeTakeFirst();
  return row && toSendRow(row);
}
// `from` guards the change. An `approved` send closes only when no run holds it (`locked_at` null or before `staleBefore`).
// `result_notified_at` stays null: the notifier sends the result (D20). `resultNotifiedAt` is for the send that a panel edit
// replaced (`superseded`): no result notice is due (F102 ticket). The caller writes the audit row.
export async function setExpired(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  opts: { reason: string; at: Date; from: "awaiting_approval" | "approved"; staleBefore: Date; resultNotifiedAt?: Date }
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({
      status: "expired",
      status_reason: opts.reason,
      locked_at: null,
      next_attempt_at: null,
      updated_at: opts.at,
      ...(opts.resultNotifiedAt === undefined ? {} : { result_notified_at: opts.resultNotifiedAt }),
    })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "=", opts.from)
    .$if(opts.from === "approved", (qb) =>
      qb.where((eb) => eb.or([eb("locked_at", "is", null), eb("locked_at", "<", opts.staleBefore)]))
    )
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
// Ids of the reminder sends of a delegation that can still be closed, locked FOR UPDATE.
// Lock order (D6): the caller holds the delegation lock. Only `awaiting_approval` and `approved` rows are selected on purpose:
// a reminder in flight is `applying`, and the committer holds that row while it waits for the delegation lock.
// Selecting `applying` rows here would close the cycle and deadlock.
export async function listOpenReminderSends(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegationId: string
): Promise<string[]> {
  const rows = await trx
    .selectFrom("actions")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "in", ["awaiting_approval", "approved"])
    .where(sql<string>`payload->>'delegation_id'`, "=", delegationId)
    .where(sql<boolean>`jsonb_exists(payload, 'reminder')`)
    .orderBy("created_at")
    .orderBy("id")
    .forUpdate()
    .execute();
  return rows.map((row) => row.id);
}
export async function setApproved(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  input: { userId: string; via: string; at: Date }
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({
      status: "approved",
      approved_by: input.userId,
      approved_at: input.at,
      approved_via: input.via,
      updated_at: input.at,
    })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "=", "awaiting_approval")
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
// An `approved` row that a run holds (`locked_at` at or after `staleBefore`) finishes: it is not rejected.
// The caller writes the audit row. `result_notified_at` stays null (D20).
export async function setRejected(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  opts: { at: Date; staleBefore: Date }
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({ status: "rejected", status_reason: "rejected", locked_at: null, next_attempt_at: null, updated_at: opts.at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where((eb) =>
      eb.or([
        eb("status", "=", "awaiting_approval"),
        eb.and([
          eb("status", "=", "approved"),
          eb.or([eb("locked_at", "is", null), eb("locked_at", "<", opts.staleBefore)]),
        ]),
      ])
    )
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
// The sends of one reminder set, locked FOR UPDATE (the action rows only).
export async function listSetSends(trx: Transaction<DB>, ctx: TenantContext, setId: string): Promise<SendRow[]> {
  const rows = await sendBase(trx, ctx)
    .where(sql<string>`actions.payload->>'set_id'`, "=", setId)
    .orderBy("actions.created_at")
    .orderBy("actions.id")
    .forUpdate("actions")
    .execute();
  return rows.map(toSendRow);
}
// The oldest send of a reminder set, for a reader that needs the mail behind the set. `undefined` = no such set in this organization.
export async function getSetSend(db: DbOrTrx, ctx: TenantContext, setId: string): Promise<SendRow | undefined> {
  const row = await sendBase(db, ctx)
    .where(sql<string>`actions.payload->>'set_id'`, "=", setId)
    .orderBy("actions.created_at")
    .orderBy("actions.id")
    .limit(1)
    .executeTakeFirst();
  return row && toSendRow(row);
}
export async function findSendByKey(
  trx: Transaction<DB>,
  ctx: TenantContext,
  key: string
): Promise<{ id: string } | undefined> {
  return trx
    .selectFrom("actions")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("idempotency_key", "=", key)
    .executeTakeFirst();
}
// "Send again" (D18): one new `approved` send per failed row, same draft. Null when the key exists.
export async function insertSendAgain(
  trx: Transaction<DB>,
  ctx: TenantContext,
  previous: SendRow,
  input: { userId: string; via: string; at: Date }
): Promise<string | null> {
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      email_id: previous.email_id,
      type: "send",
      status: "approved",
      payload: JSON.stringify(previous.payload),
      idempotency_key: `${previous.id}:again`,
      depends_on_action_id: previous.depends_on_action_id,
      approved_by: input.userId,
      approved_at: input.at,
      approved_via: input.via,
    })
    .onConflict((oc) => oc.columns(["org_id", "idempotency_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  return row?.id ?? null;
}

// Serializes the limit check of one mailbox until the transaction ends (D6). Like `lockMailboxLimit` (mail/repo):
// outside a transaction the lock would end with its own statement, so it throws.
export async function lockMailboxSends(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<void> {
  if (!db.isTransaction) throw new Error("lockMailboxSends needs a transaction");
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`send_limit:${ctx.orgId}:${mailboxId}`}, 0))`.execute(db);
}

// PD-044 (D4): the sends of one mailbox that may have reached people and started after `since`.
// A send of an incoming mail belongs to the mailbox of that mail; a send of a loop (a follow-up) to the mailbox of the loop.
// The follow-up must count here: this is what holds a follow-up behind the send limits of its mailbox and recipients.
// An `approved` row with an old stamp (put back before a retry), `rejected`, `expired` and refused sends do not count.
// `to` holds the strings of `payload.to` and `payload.cc`; retention may have cleared the payload, then `to` is [].
export async function listRecentSends(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<RecentSend[]> {
  const rows = await db
    .selectFrom("actions")
    .leftJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .leftJoin("open_loops", (join) =>
      join.onRef("open_loops.id", "=", "actions.loop_id").onRef("open_loops.org_id", "=", "actions.org_id")
    )
    .select(["actions.id", "actions.send_started_at", "actions.payload"])
    .where("actions.org_id", "=", ctx.orgId)
    .where((eb) =>
      eb.or([
        eb.and([eb("emails.org_id", "=", ctx.orgId), eb("emails.mailbox_id", "=", mailboxId)]),
        eb.and([eb("open_loops.org_id", "=", ctx.orgId), eb("open_loops.mailbox_id", "=", mailboxId)]),
      ])
    )
    .where("actions.type", "=", "send")
    .where("actions.send_started_at", ">", since)
    .where((eb) =>
      eb.or([
        eb("actions.status", "in", ["applying", "applied"]),
        eb.and([eb("actions.status", "=", "failed"), eb("actions.status_reason", "=", "outcome_unknown")]),
      ])
    )
    .orderBy("actions.send_started_at")
    .orderBy("actions.id")
    .execute();
  return rows.flatMap((row) =>
    row.send_started_at === null ? [] : [{ startedAt: row.send_started_at, to: recipientsOf(row.payload) }]
  );
}

function recipientsOf(payload: unknown): string[] {
  const read = (key: "to" | "cc"): string[] => {
    const list = (payload as Record<string, unknown> | null)?.[key];
    return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : [];
  };
  return [...read("to"), ...read("cc")];
}

// F099 D17: sends of the organization that ended `failed` after `since` (by `updated_at`).
export async function countFailedSendsSince(db: DbOrTrx, ctx: TenantContext, since: Date): Promise<number> {
  const row = await db
    .selectFrom("actions")
    .select(sql<string>`count(*)`.as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "=", "failed")
    .where("updated_at", ">", since)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

// F099 D14: the newest `applied_at` of an applied send of the organization, null when none.
export async function lastSendAppliedAt(db: DbOrTrx, ctx: TenantContext): Promise<Date | null> {
  const row = await db
    .selectFrom("actions")
    .select("applied_at")
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "=", "applied")
    .where("applied_at", "is not", null)
    .orderBy("applied_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.applied_at ?? null;
}

// F102 ticket: the newest version of a send through `supersedes_action_id` (the send itself when nothing replaced it).
// One recursive query, tenant-scoped on both sides; the unique index on `supersedes_action_id` makes the chain a line.
export async function newestVersionOf(db: DbOrTrx, ctx: TenantContext, id: string): Promise<string> {
  const result = await sql<{ id: string }>`
    with recursive chain(id, depth) as (
      select a.id, 0 from actions a where a.org_id = ${ctx.orgId} and a.id = ${id} and a.type = 'send'
      union all
      select n.id, c.depth + 1
      from chain c
      join actions n on n.org_id = ${ctx.orgId} and n.supersedes_action_id = c.id and n.type = 'send'
      where c.depth < 1000
    )
    select id from chain order by depth desc limit 1
  `.execute(db);
  return result.rows[0]?.id ?? id;
}
