import type { SuspiciousReason } from "@ea/core";
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

// The senders (of `sendersLower`, lower case) with at least one mail in this mailbox since `since` whose newest result has
// reasons (F110 stage 22; PD-063: bulk unsubscribe never touches a flagged sender). The rule is per sender: one flagged mail
// puts the sender in the set, an older flagged row under a clean newest row does not (the pattern of `listFrequentSenders`).
// Queries `from_address_lower` (index `emails_mailbox_sender_idx`): never `lower(from_address)`. Mail with no result does not count.
export async function suspiciousSendersOf(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  sendersLower: readonly string[],
  since: Date
): Promise<Set<string>> {
  if (sendersLower.length === 0) return new Set();
  const { rows } = await sql<{ sender: string }>`
    SELECT DISTINCT e.from_address_lower AS sender
    FROM emails e
    JOIN LATERAL (
      SELECT tr.suspicious_reasons
      FROM triage_results tr
      WHERE tr.org_id = e.org_id AND tr.email_id = e.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) latest ON true
    WHERE e.org_id = ${ctx.orgId}
      AND e.mailbox_id = ${mailboxId}
      AND e.from_address_lower = ANY(${sendersLower as string[]}::text[])
      AND e.received_at >= ${since}
      AND cardinality(latest.suspicious_reasons) > 0
  `.execute(db);
  return new Set(rows.map((row) => row.sender));
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

// The reasons of the newest `triage_results` row of each mail (F109 D5). A mail with no row, or a row with no reason, is absent.
// It ignores the flag `suspicious_mail`: a caller that blocks a draft blocks it with the flag off too (PD-063 is a safety rule).
// Readers for follow-ups, reply drafts and unsubscribe call this before they draft or act. The organization comes from `ctx`.
export async function suspiciousReasonsOf(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, SuspiciousReason[]>> {
  const found = new Map<string, SuspiciousReason[]>();
  if (emailIds.length === 0) return found;
  const { rows } = await sql<{ email_id: string; suspicious_reasons: SuspiciousReason[] }>`
    SELECT latest.email_id, latest.suspicious_reasons
    FROM (
      SELECT DISTINCT ON (tr.email_id) tr.email_id, tr.suspicious_reasons
      FROM triage_results tr
      WHERE tr.org_id = ${ctx.orgId}
        AND tr.email_id = ANY(${emailIds as string[]}::uuid[])
      ORDER BY tr.email_id, tr.created_at DESC, tr.id DESC
    ) latest
    WHERE cardinality(latest.suspicious_reasons) > 0
  `.execute(db);
  for (const row of rows) found.set(row.email_id, row.suspicious_reasons);
  return found;
}

// The thread keys (of `threadKeys`, in this mailbox) with at least one incoming mail whose newest result has reasons.
// The rule of a follow-up is per thread (PD-128): one flagged mail blocks the thread, an older flagged row under a clean newest row does not.
export async function suspiciousThreadKeysOf(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  threadKeys: readonly string[]
): Promise<Set<string>> {
  if (threadKeys.length === 0) return new Set();
  const { rows } = await sql<{ thread_key: string }>`
    SELECT DISTINCT e.thread_key
    FROM emails e
    JOIN LATERAL (
      SELECT tr.suspicious_reasons
      FROM triage_results tr
      WHERE tr.org_id = e.org_id AND tr.email_id = e.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) latest ON true
    WHERE e.org_id = ${ctx.orgId}
      AND e.mailbox_id = ${mailboxId}
      AND e.thread_key = ANY(${threadKeys as string[]}::text[])
      AND cardinality(latest.suspicious_reasons) > 0
  `.execute(db);
  return new Set(rows.map((row) => row.thread_key));
}
