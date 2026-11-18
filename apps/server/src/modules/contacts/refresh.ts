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
  // Rows inserted or changed (a row whose values did not change is not written).
  written: number;
  // Rows read whose stored values were already the same: no write.
  unchanged: number;
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

// The WHERE of the upsert: the row is written only when one value differs from what is stored. The dates compare after the
// widening (`least`, `greatest`), so a read that holds an older Sent date than the stored one changes nothing.
// `IS DISTINCT FROM` treats NULL as a value. The columns are listed one by one: a new column must join this list (the
// test "a repeat pass writes no row" changes each value in turn and fails for a column that is missing).
const CHANGED = sql<boolean>`(
  (sender_profiles.received, sender_profiles.moved_back, sender_profiles.answered, sender_profiles.flagged,
    sender_profiles.unseen_7d, sender_profiles.user_mails_to, sender_profiles.delegations_to,
    sender_profiles.reply_samples_theirs, sender_profiles.relation, sender_profiles.by_category,
    sender_profiles.corrections, sender_profiles.bulk_signals, sender_profiles.median_user_reply_hours,
    sender_profiles.median_their_reply_hours)
  IS DISTINCT FROM
  (excluded.received, excluded.moved_back, excluded.answered, excluded.flagged, excluded.unseen_7d,
    excluded.user_mails_to, excluded.delegations_to, excluded.reply_samples_theirs, excluded.relation,
    excluded.by_category, excluded.corrections, excluded.bulk_signals, excluded.median_user_reply_hours,
    excluded.median_their_reply_hours)
  OR sender_profiles.first_seen_at IS DISTINCT FROM least(sender_profiles.first_seen_at, excluded.first_seen_at)
  OR sender_profiles.last_seen_at IS DISTINCT FROM greatest(sender_profiles.last_seen_at, excluded.last_seen_at)
  OR sender_profiles.last_user_mail_at IS DISTINCT FROM
    greatest(sender_profiles.last_user_mail_at, excluded.last_user_mail_at)
)`;

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
// keeps its dates (retention deletes it later). A row whose new values equal the stored values is not written (an UPDATE of
// an equal row still leaves a dead tuple: 5,300 senders would leave 5,300 a pass, every hour), so `refreshed_at` is the time
// of the last change of the row, not of the last pass.
export async function refreshMailboxProfiles(
  deps: RefreshDeps,
  ctx: TenantContext,
  mailboxId: string,
  options: { now: Date }
): Promise<RefreshResult> {
  const { now } = options;
  const run = async (trx: DbOrTrx): Promise<RefreshResult> => {
    if (!(await isFeatureOn(trx, ctx, "sender_context"))) return { written: 0, unchanged: 0, zeroed: 0, skipped: true };
    if (!(await tryLockProfiles(trx, mailboxId))) return { written: 0, unchanged: 0, zeroed: 0, skipped: true };

    const activity = await readSenderActivity(trx, ctx, mailboxId, { now, testMail: deps.testMail });
    const hashes: string[] = [];
    let written = 0;
    for (let start = 0; start < activity.length; start += WRITE_CHUNK) {
      const chunk = activity.slice(start, start + WRITE_CHUNK);
      const rows = chunk.map((item) => {
        const hash = senderKeyHash(deps.credentialsKey, ctx.orgId, item.address);
        hashes.push(hash);
        return insertRow(ctx, mailboxId, hash, item, now);
      });
      const changed = await trx
        .insertInto("sender_profiles")
        .values(rows)
        .onConflict((conflict) =>
          conflict
            .columns(["mailbox_id", "key_hash"])
            .doUpdateSet((eb) => ({
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
            .where(CHANGED)
        )
        .returning("id")
        .execute();
      written += changed.length;
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
    return { written, unchanged: hashes.length - written, zeroed: Number(zeroed.numAffectedRows ?? 0), skipped: false };
  };
  return deps.db.isTransaction ? run(deps.db) : deps.db.transaction().execute(run);
}
