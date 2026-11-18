import { DAY_MS, senderHistorySchema, type Category, type SenderHistory } from "@ea/core";
import { sql, type Transaction } from "kysely";

import { senderKeyHash } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";

import { PROFILE_DAYS } from "./activity";

type DbOrTrx = Db | Transaction<DB>;

// Pairs per query: 2 values a pair stay far below the 65,535 parameter limit.
const PAIR_CHUNK = 1000;

interface ProfileRow {
  mailbox_id: string;
  key_hash: string;
  received: number;
  moved_back: number;
  answered: number;
  flagged: number;
  unseen_7d: number;
  user_mails_to: number;
  delegations_to: number;
  by_category: Partial<Record<Category, number>>;
  corrections: Partial<Record<Category, number>>;
  bulk_signals: SenderHistory["bulkSignals"];
  median_user_reply_hours: number | null;
  median_their_reply_hours: number | null;
  relation: SenderHistory["relation"];
  first_seen_at: Date | null;
  last_seen_at: Date | null;
  last_user_mail_at: Date | null;
}

// Whole days from `then` to `now`; a date in the future (clock skew) reads as 0.
function daysAgo(then: Date | null, now: Date): number | null {
  if (then === null) return null;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / DAY_MS));
}

// The profiles of `(mailboxId, address)` pairs as `SenderHistory`, in one query for up to 1,000 pairs (more pairs go in chunks).
// The address is hashed here; the key of the result is `${mailboxId}:${lower address}`, and the map never leaves the process.
// A pair with no stored row is absent from the map.
export async function readProfiles(
  deps: { db: DbOrTrx; credentialsKey: string },
  ctx: TenantContext,
  pairs: readonly { mailboxId: string; address: string }[],
  now: Date
): Promise<Map<string, SenderHistory>> {
  const result = new Map<string, SenderHistory>();
  for (let start = 0; start < pairs.length; start += PAIR_CHUNK) {
    const chunk = pairs.slice(start, start + PAIR_CHUNK).map((pair) => {
      const address = pair.address.trim().toLowerCase();
      return {
        mailboxId: pair.mailboxId,
        address,
        hash: senderKeyHash(deps.credentialsKey, ctx.orgId, address),
      };
    });
    const { rows } = await sql<ProfileRow>`
      SELECT mailbox_id, key_hash, received, moved_back, answered, flagged, unseen_7d, user_mails_to, delegations_to,
        by_category, corrections, bulk_signals, median_user_reply_hours, median_their_reply_hours, relation,
        first_seen_at, last_seen_at, last_user_mail_at
      FROM sender_profiles
      WHERE org_id = ${ctx.orgId}
        AND (mailbox_id, key_hash) IN (${sql.join(chunk.map((pair) => sql`(${pair.mailboxId}::uuid, ${pair.hash})`))})
    `.execute(deps.db);
    const byKey = new Map(rows.map((row) => [`${row.mailbox_id}:${row.key_hash}`, row]));
    for (const pair of chunk) {
      const row = byKey.get(`${pair.mailboxId}:${pair.hash}`);
      if (row === undefined) continue;
      result.set(
        `${pair.mailboxId}:${pair.address}`,
        senderHistorySchema.parse({
          days: PROFILE_DAYS,
          received: row.received,
          byCategory: row.by_category,
          corrections: row.corrections,
          movedBack: row.moved_back,
          answered: row.answered,
          flagged: row.flagged,
          unseen7d: row.unseen_7d,
          userMailsTo: row.user_mails_to,
          lastUserMailDaysAgo: daysAgo(row.last_user_mail_at, now),
          delegationsTo: row.delegations_to,
          bulkSignals: row.bulk_signals,
          firstSeenDaysAgo: daysAgo(row.first_seen_at, now),
          lastSeenDaysAgo: daysAgo(row.last_seen_at, now),
          medianUserReplyHours: row.median_user_reply_hours,
          medianTheirReplyHours: row.median_their_reply_hours,
          relation: row.relation,
        })
      );
    }
  }
  return result;
}
