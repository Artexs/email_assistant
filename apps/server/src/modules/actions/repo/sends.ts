import type { RecentSend } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";

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
export function sendBase(db: DbOrTrx, ctx: TenantContext) {
  return db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select([
      "actions.id",
      "actions.email_id",
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
    email_id: row.email_id,
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
// `result_notified_at` stays null: the notifier sends the result (D20). The caller writes the audit row.
export async function setExpired(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  opts: { reason: string; at: Date; from: "awaiting_approval" | "approved"; staleBefore: Date }
): Promise<boolean> {
  const result = await trx
    .updateTable("actions")
    .set({ status: "expired", status_reason: opts.reason, locked_at: null, next_attempt_at: null, updated_at: opts.at })
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

// PD-044 (D4): the sends of one mailbox that may have reached people and started after `since`.
// An `approved` row with an old stamp (put back before a retry), `rejected`, `expired` and refused sends do not count.
// `to` holds the strings of `payload.to`; retention may have cleared the payload, then `to` is [].
export async function listRecentSends(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<RecentSend[]> {
  const rows = await db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select(["actions.id", "actions.send_started_at", "actions.payload"])
    .where("actions.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.mailbox_id", "=", mailboxId)
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
  const to = (payload as { to?: unknown } | null)?.to;
  return Array.isArray(to) ? to.filter((entry): entry is string => typeof entry === "string") : [];
}
