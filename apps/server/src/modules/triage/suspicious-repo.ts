import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

// The frequent-sender window and count (F109 D4).
export const FREQUENT_WINDOW_DAYS = 90;
export const FREQUENT_MIN_MAILS = 3;

// The lower-case addresses among `senders` with at least `FREQUENT_MIN_MAILS` mails in this mailbox in the window, each mail
// with a newest result that is not `spam` and has no suspicious reason (review N1, N15). Flagged mail and spam never make a
// sender known. Queries `from_address_lower` (index `emails_mailbox_sender_idx`): never `lower(from_address)`, which the tenant
// policy blocks as an index condition. Mail without a result (not triaged yet, skipped) does not count.
export async function listFrequentSenders(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  senders: readonly string[],
  since: Date
): Promise<string[]> {
  if (senders.length === 0) return [];
  const { rows } = await sql<{ sender: string }>`
    SELECT e.from_address_lower AS sender
    FROM emails e
    JOIN LATERAL (
      SELECT tr.category, tr.suspicious_reasons
      FROM triage_results tr
      WHERE tr.org_id = e.org_id AND tr.email_id = e.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) latest ON true
    WHERE e.org_id = ${ctx.orgId}
      AND e.mailbox_id = ${mailboxId}
      AND e.from_address_lower = ANY(${senders as string[]}::text[])
      AND e.received_at >= ${since}
      AND latest.category <> 'spam'
      AND latest.suspicious_reasons = '{}'::text[]
    GROUP BY e.from_address_lower
    HAVING count(*) >= ${FREQUENT_MIN_MAILS}
  `.execute(db);
  return rows.map((row) => row.sender);
}

// The newest non-empty `from_name` of mail from each address in this mailbox in the window (the display names of VIPs).
export async function listNewestFromNames(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  addresses: readonly string[],
  since: Date
): Promise<string[]> {
  if (addresses.length === 0) return [];
  const { rows } = await sql<{ from_name: string }>`
    SELECT DISTINCT ON (e.from_address_lower) h.from_name
    FROM emails e
    JOIN email_headers h ON h.email_id = e.id AND h.org_id = e.org_id
    WHERE e.org_id = ${ctx.orgId}
      AND e.mailbox_id = ${mailboxId}
      AND e.from_address_lower = ANY(${addresses as string[]}::text[])
      AND e.received_at >= ${since}
      AND h.from_name IS NOT NULL AND h.from_name <> ''
    ORDER BY e.from_address_lower, e.received_at DESC, e.id DESC
  `.execute(db);
  return rows.map((row) => row.from_name);
}
