// Row reader of the urgent notice time (M5). Every table is joined with its own `org_id` filter; no subject, no text.
import type { UrgentNoticeRow, WeekQuery } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { mailKindFilter } from "../mail";

type DbOrTrx = Db | Transaction<DB>;

const rowSchema = z.object({
  email_id: z.string(),
  received_at: z.date(),
  notice_at: z.date().nullable(),
});

/** Real, non-backfilled mail of the week whose latest triage category is `urgent`, with its first sent urgent notice. */
export async function listUrgentNoticeTimes(db: DbOrTrx, ctx: TenantContext, q: WeekQuery): Promise<UrgentNoticeRow[]> {
  const mailbox = q.mailboxId === null ? sql`true` : sql`emails.mailbox_id = ${q.mailboxId}`;
  const { rows } = await sql<unknown>`
    SELECT emails.id AS email_id, emails.received_at,
      (
        SELECT MIN(o.sent_at) FROM outbox o
        WHERE o.org_id = ${ctx.orgId} AND o.email_id = emails.id AND o.kind = 'urgent' AND o.status = 'sent'
      ) AS notice_at
    FROM emails
    JOIN LATERAL (
      SELECT tr.category
      FROM triage_results tr
      WHERE tr.org_id = ${ctx.orgId} AND tr.email_id = emails.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) t ON true
    WHERE emails.org_id = ${ctx.orgId}
      AND t.category = 'urgent'
      AND emails.backfilled_at IS NULL
      AND emails.received_at >= ${q.range.start} AND emails.received_at < ${q.range.end}
      AND ${mailbox}
      AND ${mailKindFilter("real", q.testMail)}
    ORDER BY emails.received_at, emails.id
  `.execute(db);
  return rows.map((raw) => {
    const row = rowSchema.parse(raw);
    return { emailId: row.email_id, receivedAt: row.received_at, noticeAt: row.notice_at };
  });
}
