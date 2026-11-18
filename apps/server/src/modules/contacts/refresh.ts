import { sql, type Transaction } from "kysely";

import { senderKeyHash } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import type { TestMailRule } from "../mail";
import { isFeatureOn } from "../tenancy";

import { readSenderActivity, type SenderActivity } from "./activity";

type DbOrTrx = Db | Transaction<DB>;

// Rows per INSERT: 20 values a row stay far below the 65,535 parameter limit of the wire protocol.
const WRITE_CHUNK = 200;

export interface RefreshDeps {
  // A plain `Db` opens one transaction; a `Transaction` (a test) is the transaction.
  db: DbOrTrx;
  // `CREDENTIALS_KEY`: the key of `senderKeyHash`. It never leaves the server and never reaches a log or a table.
  credentialsKey: string;
  testMail: TestMailRule;
}

export interface RefreshResult {
  written: number;
  zeroed: number;
  // True when the flag `sender_context` is off or another pass or a data-request erase holds the lock: nothing was read or written.
  skipped: boolean;
}

// The text of the per-mailbox advisory lock. The pass takes it with try; the data-request erase takes it and waits, for each
// mailbox, before it deletes (so a pass never writes back an erased row). Use it as `hashtextextended(<key>, 0)`.
export function profileLockKey(mailboxId: string): string {
  return `contacts_profile:${mailboxId}`;
}

// Takes the lock for the rest of the transaction; false when another transaction holds it.
export async function tryLockProfiles(trx: DbOrTrx, mailboxId: string): Promise<boolean> {
  const { rows } = await sql<{ locked: boolean }>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${profileLockKey(mailboxId)}, 0)) AS locked
  `.execute(trx);
  return rows[0]?.locked === true;
}

function insertRow(ctx: TenantContext, mailboxId: string, hash: string, item: SenderActivity, now: Date) {
  return {
    org_id: ctx.orgId,
    mailbox_id: mailboxId,
    key_hash: hash,
    received: item.received,
    moved_back: item.movedBack,
    answered: item.answered,
    flagged: item.flagged,
    unseen_7d: item.unseen7d,
    user_mails_to: item.userMailsTo,
    delegations_to: item.delegationsTo,
    by_category: JSON.stringify(item.byCategory),
    corrections: JSON.stringify(item.corrections),
    bulk_signals: item.bulkSignals,
    median_user_reply_hours: item.medianUserReplyHours,
    median_their_reply_hours: item.medianTheirReplyHours,
    reply_samples_theirs: item.replySamplesTheirs,
    relation: item.relation,
    first_seen_at: item.firstSeenAt,
    last_seen_at: item.lastSeenAt,
    last_user_mail_at: item.lastUserMailAt,
    refreshed_at: now,
  };
}

// One recompute pass for one mailbox (the profile is a derived snapshot of the source tables of 90 days). One
// transaction. Order: the flag `sender_context` (off: nothing happens), the advisory lock with try (busy: skip), then the read
// inside the lock, then the writes. A row written has the keyed hash of the address and counts, medians and dates: never an
// address. The dates only widen (`first_seen_at` the least, `last_seen_at` and `last_user_mail_at` the greatest of the stored and
// the read value). A row of the mailbox that the read did not return gets zero counts, null medians and the relation `new`, and
// keeps its dates (retention deletes it later).
export async function refreshMailboxProfiles(
  deps: RefreshDeps,
  ctx: TenantContext,
  mailboxId: string,
  options: { now: Date }
): Promise<RefreshResult> {
  const { now } = options;
  const run = async (trx: DbOrTrx): Promise<RefreshResult> => {
    if (!(await isFeatureOn(trx, ctx, "sender_context"))) return { written: 0, zeroed: 0, skipped: true };
    if (!(await tryLockProfiles(trx, mailboxId))) return { written: 0, zeroed: 0, skipped: true };

    const activity = await readSenderActivity(trx, ctx, mailboxId, { now, testMail: deps.testMail });
    const hashes: string[] = [];
    for (let start = 0; start < activity.length; start += WRITE_CHUNK) {
      const chunk = activity.slice(start, start + WRITE_CHUNK);
      const rows = chunk.map((item) => {
        const hash = senderKeyHash(deps.credentialsKey, ctx.orgId, item.address);
        hashes.push(hash);
        return insertRow(ctx, mailboxId, hash, item, now);
      });
      await trx
        .insertInto("sender_profiles")
        .values(rows)
        .onConflict((conflict) =>
          conflict.columns(["mailbox_id", "key_hash"]).doUpdateSet((eb) => ({
            received: eb.ref("excluded.received"),
            moved_back: eb.ref("excluded.moved_back"),
            answered: eb.ref("excluded.answered"),
            flagged: eb.ref("excluded.flagged"),
            unseen_7d: eb.ref("excluded.unseen_7d"),
            user_mails_to: eb.ref("excluded.user_mails_to"),
            delegations_to: eb.ref("excluded.delegations_to"),
            by_category: eb.ref("excluded.by_category"),
            corrections: eb.ref("excluded.corrections"),
            bulk_signals: eb.ref("excluded.bulk_signals"),
            median_user_reply_hours: eb.ref("excluded.median_user_reply_hours"),
            median_their_reply_hours: eb.ref("excluded.median_their_reply_hours"),
            reply_samples_theirs: eb.ref("excluded.reply_samples_theirs"),
            relation: eb.ref("excluded.relation"),
            // LEAST and GREATEST skip NULL: a date that one side lacks never erases the other.
            first_seen_at: sql`least(sender_profiles.first_seen_at, excluded.first_seen_at)`,
            last_seen_at: sql`greatest(sender_profiles.last_seen_at, excluded.last_seen_at)`,
            last_user_mail_at: sql`greatest(sender_profiles.last_user_mail_at, excluded.last_user_mail_at)`,
            refreshed_at: eb.ref("excluded.refreshed_at"),
          }))
        )
        .execute();
    }

    // The rows that left the window: zero counts, no medians, relation `new`; the dates stay. A row that is already zero stays as it is.
    const zeroed = await sql`
      UPDATE sender_profiles
      SET received = 0, moved_back = 0, answered = 0, flagged = 0, unseen_7d = 0, user_mails_to = 0, delegations_to = 0,
          reply_samples_theirs = 0, by_category = '{}', corrections = '{}', bulk_signals = '{}',
          median_user_reply_hours = NULL, median_their_reply_hours = NULL, relation = 'new', refreshed_at = ${now}
      WHERE org_id = ${ctx.orgId}
        AND mailbox_id = ${mailboxId}
        AND key_hash <> ALL(${hashes}::text[])
        AND (received <> 0 OR moved_back <> 0 OR answered <> 0 OR flagged <> 0 OR unseen_7d <> 0 OR user_mails_to <> 0
          OR delegations_to <> 0 OR reply_samples_theirs <> 0 OR by_category <> '{}' OR corrections <> '{}'
          OR bulk_signals <> '{}' OR median_user_reply_hours IS NOT NULL OR median_their_reply_hours IS NOT NULL
          OR relation <> 'new')
    `.execute(trx);
    return { written: hashes.length, zeroed: Number(zeroed.numAffectedRows ?? 0), skipped: false };
  };
  return deps.db.isTransaction ? run(deps.db) : deps.db.transaction().execute(run);
}
