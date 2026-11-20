import { normalizeAddress } from "@ea/core";
import { sql, type Transaction } from "kysely";

import { senderKeyHash } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";

import { profileLockKey } from "./refresh";

type DbOrTrx = Db | Transaction<DB>;

const RETENTION_BATCH = 1000;

// Retention of the profiles. A profile goes when the newest of its two dates (`last_seen_at`, the last incoming mail, and
// `last_user_mail_at`, the last Sent mail to the contact) is older than `before`: a contact the user still writes to is
// still known. The table CHECK `sender_profiles_dates_check` gives every row at least one of the two dates, so the rule
// needs no clause for a row without a date (a test pins the CHECK). The rule does NOT age by `refreshed_at`: that column is
// the time of the last CHANGE of the row, so a row that stays the same for a year would go while it is still current. It
// ignores the flags: data of a switched-off `sender_context` ages out too. Batches of rows selected by id,
// `FOR UPDATE SKIP LOCKED`; a repeat call changes nothing.
export async function deleteOldProfiles(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await sql`
      DELETE FROM sender_profiles
      WHERE org_id = ${ctx.orgId}
        AND id IN (
          SELECT id FROM sender_profiles
          WHERE org_id = ${ctx.orgId}
            AND greatest(last_seen_at, last_user_mail_at) < ${opts.before}
          ORDER BY id
          LIMIT ${batch}
          FOR UPDATE SKIP LOCKED
        )
    `.execute(db);
    const changed = Number(result.numAffectedRows ?? 0);
    total += changed;
    if (changed === 0) return total;
  }
}

// Retention of the suggestions. First an open suggestion created before `openBefore` ends as `expired`: its `pattern` (the
// address or domain) is cleared and `ended_at` is `now`. Then every ended suggestion whose `ended_at` is before `before` is
// deleted (a dismissed row hides its key until then). Returns the rows expired plus the rows deleted. The rule ignores the flags.
export async function deleteEndedSuggestions(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; openBefore: Date; now: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await sql`
      UPDATE sender_suggestions
      SET status = 'expired', pattern = NULL, ended_at = ${opts.now}
      WHERE org_id = ${ctx.orgId}
        AND id IN (
          SELECT id FROM sender_suggestions
          WHERE org_id = ${ctx.orgId} AND status = 'open' AND created_at < ${opts.openBefore}
          ORDER BY id
          LIMIT ${batch}
          FOR UPDATE SKIP LOCKED
        )
    `.execute(db);
    const changed = Number(result.numAffectedRows ?? 0);
    total += changed;
    if (changed === 0) break;
  }
  for (;;) {
    const result = await sql`
      DELETE FROM sender_suggestions
      WHERE org_id = ${ctx.orgId}
        AND id IN (
          SELECT id FROM sender_suggestions
          WHERE org_id = ${ctx.orgId} AND status <> 'open' AND ended_at < ${opts.before}
          ORDER BY id
          LIMIT ${batch}
          FOR UPDATE SKIP LOCKED
        )
    `.execute(db);
    const changed = Number(result.numAffectedRows ?? 0);
    total += changed;
    if (changed === 0) return total;
  }
}

// The data-request erase takes the profile lock of every mailbox of the organization, in mailbox id order, and waits for it
// (the pass takes it with try and skips). A pass that already read the mail finishes and commits first, so the erase deletes
// the row that it wrote; a pass that starts later skips, and its next run reads the mail after the erase. The locks last to
// the end of the transaction. The id order is the same in every erase, so two erases never wait for each other in a circle.
export async function lockProfilesOfOrg(trx: Transaction<DB>, ctx: TenantContext): Promise<void> {
  const { rows } = await sql<{ id: string }>`
    SELECT id FROM mailboxes WHERE org_id = ${ctx.orgId} ORDER BY id
  `.execute(trx);
  for (const { id } of rows) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${profileLockKey(id)}, 0))`.execute(trx);
  }
}

// The rows of one person in the sender-context tables of the organization, found by the keyed hash of the address (the
// profiles hold no address). `suggestions` are the rows with that key: open ones and ended ones (an ended row has no pattern,
// only the key). A domain row (`@acme.pl`) names a domain, not the person: its key is the hash of `@acme.pl`, which no
// address hashes to, so it is never listed. The rows of an open suggestion whose `pattern` is the address are in the
// data-request map (`sender_suggestions.pattern`) too.
export interface SenderContextRows {
  profiles: string[];
  suggestions: string[];
}

export async function senderContextRowsOf(
  db: DbOrTrx,
  ctx: TenantContext,
  credentialsKey: string,
  address: string
): Promise<SenderContextRows> {
  const hash = senderKeyHash(credentialsKey, ctx.orgId, normalizeAddress(address));
  const profiles = await sql<{ id: string }>`
    SELECT id::text AS id FROM sender_profiles WHERE org_id = ${ctx.orgId} AND key_hash = ${hash} ORDER BY id
  `.execute(db);
  const suggestions = await sql<{ id: string }>`
    SELECT id::text AS id FROM sender_suggestions
    WHERE org_id = ${ctx.orgId} AND key_hash = ${hash} ORDER BY id
  `.execute(db);
  return { profiles: profiles.rows.map((row) => row.id), suggestions: suggestions.rows.map((row) => row.id) };
}

// Deletes the rows that `senderContextRowsOf` finds. The caller holds the profile locks (`lockProfilesOfOrg`).
export async function deleteSenderContextRowsOf(
  trx: Transaction<DB>,
  ctx: TenantContext,
  credentialsKey: string,
  address: string
): Promise<{ profiles: number; suggestions: number }> {
  const hash = senderKeyHash(credentialsKey, ctx.orgId, normalizeAddress(address));
  const profiles = await sql`
    DELETE FROM sender_profiles WHERE org_id = ${ctx.orgId} AND key_hash = ${hash}
  `.execute(trx);
  const suggestions = await sql`
    DELETE FROM sender_suggestions WHERE org_id = ${ctx.orgId} AND key_hash = ${hash}
  `.execute(trx);
  return { profiles: Number(profiles.numAffectedRows ?? 0), suggestions: Number(suggestions.numAffectedRows ?? 0) };
}

// For the export: the plain address of each stored profile key, where the organization still holds one. The candidates are the
// distinct addresses that stay in the organization's own rows: incoming senders, the To and Cc of Sent mail, the sender rule
// patterns that are addresses, and the delegates' e-mails. Each is hashed; a hash that equals a profile key names the address.
// A key with no candidate (the mails are past retention and no rule names it) has no entry. Read-only; the plain addresses stay
// in this process and go to the encrypted export file, never to a log or a table.
export async function senderAddressesOfProfiles(
  trx: DbOrTrx,
  ctx: TenantContext,
  credentialsKey: string
): Promise<Map<string, string>> {
  const keys = new Set(
    (
      await sql<{
        key_hash: string;
      }>`SELECT DISTINCT key_hash FROM sender_profiles WHERE org_id = ${ctx.orgId}`.execute(trx)
    ).rows.map((row) => row.key_hash)
  );
  const found = new Map<string, string>();
  if (keys.size === 0) return found;
  const take = (raw: string | null): void => {
    if (raw === null || !raw.includes("@") || raw.startsWith("@")) return;
    const address = normalizeAddress(raw);
    const hash = senderKeyHash(credentialsKey, ctx.orgId, address);
    if (keys.has(hash)) found.set(hash, address);
  };
  const sources = [
    sql<{ v: string | null }>`SELECT DISTINCT from_address_lower AS v FROM emails WHERE org_id = ${ctx.orgId}`,
    sql<{ v: string | null }>`
      SELECT DISTINCT lower(a) AS v FROM sent_emails s, unnest(s.to_addresses || s.cc_addresses) AS a
      WHERE s.org_id = ${ctx.orgId}`,
    sql<{ v: string | null }>`SELECT DISTINCT lower(pattern) AS v FROM sender_rules WHERE org_id = ${ctx.orgId}`,
    sql<{ v: string | null }>`SELECT DISTINCT lower(email) AS v FROM delegates WHERE org_id = ${ctx.orgId}`,
  ];
  for (const source of sources) {
    // Each source is read whole: its size is bounded by the distinct addresses of the organization.
    for (const row of (await source.execute(trx)).rows) take(row.v);
    if (found.size === keys.size) break;
  }
  return found;
}
