// Row reader of the open-loops metric (M2). Every table is joined with its own `org_id` filter; no text.
import type { DelegationDueRow, WeekQuery } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { mailKindFilter } from "../mail";

type DbOrTrx = Db | Transaction<DB>;

const rowSchema = z.object({
  id: z.string(),
  sent_at: z.date(),
  due_at: z.date().nullable(),
  answered_at: z.date().nullable(),
  done_at: z.date().nullable(),
  overdue_at: z.date().nullable(),
  cancelled: z.boolean(),
});

/** Sent delegations of real mail whose due time (`due_at`, else the send time plus 3 days) is in the range. */
export async function listDelegationDueRows(
  db: DbOrTrx,
  ctx: TenantContext,
  q: WeekQuery
): Promise<DelegationDueRow[]> {
  const mailbox = q.mailboxId === null ? sql`true` : sql`emails.mailbox_id = ${q.mailboxId}`;
  // The first audit row of an event for the delegation.
  const firstEvent = (event: string) => sql`(
    SELECT MIN(al.created_at) FROM audit_log al
    WHERE al.org_id = ${ctx.orgId} AND al.event = ${event} AND al.data->>'delegation_id' = d.id::text
  )`;
  const { rows } = await sql<unknown>`
    SELECT d.id, d.sent_at, d.due_at, d.answered_at,
      ${firstEvent("delegation.done")} AS done_at,
      ${firstEvent("delegation.overdue")} AS overdue_at,
      (d.status = 'cancelled') AS cancelled
    FROM delegations d
    JOIN emails ON emails.id = d.email_id AND emails.org_id = ${ctx.orgId}
    WHERE d.org_id = ${ctx.orgId} AND d.sent_at IS NOT NULL
      AND COALESCE(d.due_at, d.sent_at + interval '3 days') >= ${q.range.start}
      AND COALESCE(d.due_at, d.sent_at + interval '3 days') < ${q.range.end}
      AND ${mailbox} AND ${mailKindFilter("real", q.testMail)}
    ORDER BY d.sent_at, d.id
  `.execute(db);
  return rows.map((raw) => {
    const row = rowSchema.parse(raw);
    return {
      id: row.id,
      sentAt: row.sent_at,
      dueAt: row.due_at,
      answeredAt: row.answered_at,
      doneAt: row.done_at,
      overdueAt: row.overdue_at,
      cancelled: row.cancelled,
    };
  });
}
