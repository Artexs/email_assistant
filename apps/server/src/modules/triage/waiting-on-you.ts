import { DAY_MS } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

// How far back the "waiting on you" lines of the brief look.
export const WAITING_ON_YOU_DAYS = 14;

export interface WaitingOnYouRow {
  email_id: string;
  from_address: string | null;
  subject: string | null;
  received_at: Date;
}

// Mail that has an own answer: the IMAP `\Answered` flag, or a mail of the user in the same thread of the same mailbox
// that was sent after it arrived (a reply written in another client with no flag yet). `e` is the alias of `emails`.
function ownAnswer(orgId: string) {
  return sql`(
    COALESCE(f.answered, false)
    OR EXISTS (
      SELECT 1 FROM sent_emails s
      WHERE s.org_id = ${orgId} AND s.mailbox_id = e.mailbox_id AND s.thread_key = e.thread_key
        AND s.origin = 'user' AND s.sent_at > e.received_at
    )
  )`;
}

// The mail of the last 14 days that the latest triage put in `needs_reply`, with no own answer: the ✍️ lines of the brief.
// Oldest first. `total` counts all of them; `rows` holds at most `limit`. Only the organization of `ctx` and the given mailboxes.
export async function listWaitingOnYou(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxIds: readonly string[],
  opts: { now: Date; limit: number }
): Promise<{ rows: WaitingOnYouRow[]; total: number }> {
  if (mailboxIds.length === 0) return { rows: [], total: 0 };
  const since = new Date(opts.now.getTime() - WAITING_ON_YOU_DAYS * DAY_MS);
  const where = sql`
    FROM emails e
    JOIN LATERAL (
      SELECT tr.category FROM triage_results tr
      WHERE tr.org_id = ${ctx.orgId} AND tr.email_id = e.id
      ORDER BY tr.created_at DESC, tr.id DESC LIMIT 1
    ) t ON true
    LEFT JOIN email_flags f ON f.email_id = e.id AND f.org_id = e.org_id
    WHERE e.org_id = ${ctx.orgId}
      AND e.mailbox_id IN (${sql.join(mailboxIds)})
      AND e.received_at >= ${since} AND e.received_at <= ${opts.now}
      AND t.category = 'needs_reply'
      AND NOT ${ownAnswer(ctx.orgId)}`;
  const [list, count] = await Promise.all([
    sql<WaitingOnYouRow>`
      SELECT e.id AS email_id, e.from_address, e.subject, e.received_at ${where}
      ORDER BY e.received_at, e.id LIMIT ${opts.limit}`.execute(db),
    sql<{ n: string }>`SELECT count(*) AS n ${where}`.execute(db),
  ]);
  return { rows: list.rows, total: Number(count.rows[0]?.n ?? 0) };
}

// Which of these mails has an own answer (the 🔴 lines show urgent mail with none). Only the organization of `ctx`.
export async function answeredEmailIds(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Set<string>> {
  if (emailIds.length === 0) return new Set();
  const { rows } = await sql<{ id: string }>`
    SELECT e.id
    FROM emails e
    LEFT JOIN email_flags f ON f.email_id = e.id AND f.org_id = e.org_id
    WHERE e.org_id = ${ctx.orgId} AND e.id IN (${sql.join(emailIds)}) AND ${ownAnswer(ctx.orgId)}`.execute(db);
  return new Set(rows.map((row) => row.id));
}
