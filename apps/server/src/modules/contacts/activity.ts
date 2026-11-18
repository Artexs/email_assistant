import {
  categorySchema,
  DAY_MS,
  isNoreplyAddress,
  matchSender,
  relationOf,
  type Category,
  type SenderHistory,
  type SenderRelation,
} from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { listSenderRules } from "../config";
import { listDelegateAddresses } from "../delegation";
import { listMailboxes, mailKindFilter, type TestMailRule } from "../mail";

type DbOrTrx = Db | Transaction<DB>;
type BulkSignal = SenderHistory["bulkSignals"][number];

// The window of the profile (plan F120): mail received in the 90 days up to `now`.
export const PROFILE_DAYS = 90;
// A reply delay median needs this many samples.
const MIN_DELAY_SAMPLES = 5;
// A delay above this many hours is no sample: the column CHECK of `sender_profiles` allows up to 100000.
const MAX_DELAY_HOURS = 100_000;
// The Sent From addresses of one mailbox that the own-address set reads at most (as the loops reply rule).
const MAX_ALIASES = 100;

// What the pass knows about one sender address. It lives in memory only: the plain address never reaches a table or a log.
export interface SenderActivity {
  // Lower case.
  address: string;
  received: number;
  received30: number;
  answered: number;
  answered30: number;
  flagged: number;
  flagged30: number;
  unseen7d: number;
  movedBack: number;
  userMailsTo: number;
  delegationsTo: number;
  byCategory: Partial<Record<Category, number>>;
  corrections: Partial<Record<Category, number>>;
  // Mails whose newest feedback is a correction to `spam`, in the window.
  correctedToSpam90: number;
  // Distinct mails that the user moved back or corrected away from `spam` or `notification`.
  rescued90: number;
  // Mails whose newest triage result has suspicious reasons.
  suspicious90: number;
  bulkSignals: BulkSignal[];
  // The mails whose captured headers are not cleared, plus the noreply mails; and how many of them are bulk.
  bulkBase: number;
  bulkMails: number;
  // Hours; null below 5 samples.
  medianUserReplyHours: number | null;
  medianTheirReplyHours: number | null;
  replySamplesTheirs: number;
  // Incoming mail only. Null for a contact that the user only wrote to.
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  lastUserMailAt: Date | null;
  relation: SenderRelation;
}

export interface ReadActivityOptions {
  now: Date;
  // Test mail never counts.
  testMail: TestMailRule;
}

// `Auto-Submitted` other than `no` marks an automatic mail (RFC 3834). The column is a trusted literal.
const notAutomatic = (column: string) =>
  sql.raw(`(${column} IS NULL OR btrim(${column}) = '' OR lower(btrim(split_part(${column}, ';', 1))) = 'no')`);

const emptyActivity = (address: string): SenderActivity => ({
  address,
  received: 0,
  received30: 0,
  answered: 0,
  answered30: 0,
  flagged: 0,
  flagged30: 0,
  unseen7d: 0,
  movedBack: 0,
  userMailsTo: 0,
  delegationsTo: 0,
  byCategory: {},
  corrections: {},
  correctedToSpam90: 0,
  rescued90: 0,
  suspicious90: 0,
  bulkSignals: [],
  bulkBase: 0,
  bulkMails: 0,
  medianUserReplyHours: null,
  medianTheirReplyHours: null,
  replySamplesTheirs: 0,
  firstSeenAt: null,
  lastSeenAt: null,
  lastUserMailAt: null,
  relation: "new",
});

// The own addresses of the mailbox: every mailbox address of the organization, and the From addresses of the Sent rows of
// this mailbox (aliases, `send as`). Lower case. They never get a row.
async function ownAddresses(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<Set<string>> {
  const own = new Set((await listMailboxes(db, ctx)).map((mailbox) => mailbox.address.trim().toLowerCase()));
  const { rows } = await sql<{ address: string }>`
    SELECT lower(btrim(from_address)) AS address
    FROM sent_emails
    WHERE org_id = ${ctx.orgId} AND mailbox_id = ${mailboxId} AND from_address IS NOT NULL AND btrim(from_address) <> ''
    GROUP BY lower(btrim(from_address))
    ORDER BY max(sent_at) DESC, lower(btrim(from_address))
    LIMIT ${MAX_ALIASES}
  `.execute(db);
  for (const row of rows) own.add(row.address);
  return own;
}

interface MailRow {
  addr: string;
  received: number;
  received30: number;
  answered: number;
  answered30: number;
  flagged: number;
  flagged30: number;
  unseen7d: number;
  suspicious: number;
  hdr_ok: number;
  hdr_bulk: number;
  sig_list_id: boolean;
  sig_list_unsubscribe: boolean;
  sig_auto_submitted: boolean;
  first_at: Date;
  last_at: Date;
}

interface CategoryRow {
  addr: string;
  category: string;
  n: number;
}

interface FeedbackRow {
  addr: string;
  kind: "correction" | "moved_back" | "rescued";
  category: string | null;
  n: number;
}

interface SentRow {
  addr: string;
  n: number;
  last_at: Date;
}

interface DelayRow {
  addr: string;
  n: number;
  median: number;
}

interface DelegationRow {
  addr: string;
  n: number;
}

// The activity of every address that wrote to the mailbox or that the user wrote to, in the 90 days up to `now` (plan F120 decisions on the window, the delays and the
// bulk ratio). Set-based: a fixed number of statements for the mailbox, never one per sender. Every statement filters `org_id` and the
// mailbox. The plain addresses stay in memory: the caller hashes them before it writes (`senderKeyHash`). Own addresses and
// test mail never get a row. A mail counts once per address.
export async function readSenderActivity(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  options: ReadActivityOptions
): Promise<SenderActivity[]> {
  const { now, testMail } = options;
  const since = new Date(now.getTime() - PROFILE_DAYS * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const before7 = new Date(now.getTime() - 7 * DAY_MS);

  // The incoming mails of the window: real mail of this mailbox with a sender. `emails` has no alias, as `mailKindFilter` needs.
  const win = sql`
    SELECT emails.id, emails.from_address_lower AS addr, emails.received_at, emails.message_id_header, emails.in_reply_to
    FROM emails
    WHERE emails.org_id = ${ctx.orgId}
      AND emails.mailbox_id = ${mailboxId}
      AND emails.received_at >= ${since}
      AND emails.received_at <= ${now}
      AND emails.from_address_lower IS NOT NULL
      AND emails.from_address_lower <> ''
      AND ${mailKindFilter("real", testMail)}
  `;
  // The newest triage result and the newest feedback row of each mail of the window. One `DISTINCT ON` pass over the mailbox
  // (a hash join with the window), not one index probe per mail: the plan does not depend on the table statistics.
  const newestResult = sql`
    SELECT DISTINCT ON (tr.email_id) tr.email_id, tr.category, cardinality(tr.suspicious_reasons) > 0 AS suspicious
    FROM triage_results tr
    JOIN win ON win.id = tr.email_id
    WHERE tr.org_id = ${ctx.orgId}
    ORDER BY tr.email_id, tr.created_at DESC, tr.id DESC
  `;
  const newestFeedback = sql`
    SELECT DISTINCT ON (tf.email_id) tf.email_id, tf.verdict, tf.true_category, tf.source
    FROM triage_feedback tf
    JOIN win ON win.id = tf.email_id
    WHERE tf.org_id = ${ctx.orgId}
    ORDER BY tf.email_id, tf.created_at DESC, tf.id DESC
  `;

  const own = await ownAddresses(db, ctx, mailboxId);
  const rules = await listSenderRules(db, ctx, mailboxId);
  const delegateEmails = new Set(
    (await listDelegateAddresses(db, ctx, { activeOnly: true })).map((e) => e.trim().toLowerCase())
  );

  const mails = await sql<MailRow>`
    WITH win AS (${win}), nt AS (${newestResult}), m AS (
      SELECT
        w.addr, w.received_at,
        COALESCE(f.answered, false) AS answered,
        COALESCE(f.flagged, false) AS flagged,
        (f.email_id IS NOT NULL AND NOT f.seen) AS unseen,
        (h.email_id IS NOT NULL AND h.texts_cleared_at IS NULL) AS hdr_ok,
        (h.email_id IS NOT NULL AND h.texts_cleared_at IS NULL AND btrim(COALESCE(h.list_id, '')) <> '') AS s_list_id,
        (h.email_id IS NOT NULL AND h.texts_cleared_at IS NULL AND btrim(COALESCE(h.list_unsubscribe, '')) <> '') AS s_unsub,
        (h.email_id IS NOT NULL AND h.texts_cleared_at IS NULL AND NOT ${notAutomatic("h.auto_submitted")}) AS s_auto,
        COALESCE(nt.suspicious, false) AS suspicious
      FROM win w
      LEFT JOIN email_flags f ON f.email_id = w.id AND f.org_id = ${ctx.orgId}
      LEFT JOIN email_headers h ON h.email_id = w.id AND h.org_id = ${ctx.orgId}
      LEFT JOIN nt ON nt.email_id = w.id
    )
    SELECT
      addr,
      count(*)::int AS received,
      (count(*) FILTER (WHERE received_at >= ${since30}))::int AS received30,
      (count(*) FILTER (WHERE answered))::int AS answered,
      (count(*) FILTER (WHERE answered AND received_at >= ${since30}))::int AS answered30,
      (count(*) FILTER (WHERE flagged))::int AS flagged,
      (count(*) FILTER (WHERE flagged AND received_at >= ${since30}))::int AS flagged30,
      (count(*) FILTER (WHERE unseen AND received_at < ${before7}))::int AS unseen7d,
      (count(*) FILTER (WHERE suspicious))::int AS suspicious,
      (count(*) FILTER (WHERE hdr_ok))::int AS hdr_ok,
      (count(*) FILTER (WHERE s_list_id OR s_unsub OR s_auto))::int AS hdr_bulk,
      COALESCE(bool_or(s_list_id), false) AS sig_list_id,
      COALESCE(bool_or(s_unsub), false) AS sig_list_unsubscribe,
      COALESCE(bool_or(s_auto), false) AS sig_auto_submitted,
      min(received_at) AS first_at,
      max(received_at) AS last_at
    FROM m
    GROUP BY addr
  `.execute(db);

  const categories = await sql<CategoryRow>`
    WITH win AS (${win}), nt AS (${newestResult})
    SELECT w.addr, nt.category, count(*)::int AS n
    FROM win w
    JOIN nt ON nt.email_id = w.id
    GROUP BY w.addr, nt.category
  `.execute(db);

  // The newest feedback of each mail and the newest triage category: one correction per mail (a later mark replaces an earlier).
  const feedback = await sql<FeedbackRow>`
    WITH win AS (${win}), nt AS (${newestResult}), nf AS (${newestFeedback}), fb AS (
      SELECT w.addr, nf.verdict, nf.true_category, nf.source, nt.category AS category
      FROM win w
      JOIN nf ON nf.email_id = w.id
      LEFT JOIN nt ON nt.email_id = w.id
    )
    SELECT addr, 'correction' AS kind, true_category AS category, count(*)::int AS n
    FROM fb WHERE verdict = 'wrong' AND true_category IS NOT NULL
    GROUP BY addr, true_category
    UNION ALL
    SELECT addr, 'moved_back' AS kind, NULL AS category, count(*)::int AS n
    FROM fb WHERE source = 'imap_move'
    GROUP BY addr
    UNION ALL
    SELECT addr, 'rescued' AS kind, NULL AS category, count(*)::int AS n
    FROM fb
    WHERE category IN ('spam', 'notification')
      AND (source = 'imap_move'
        OR (verdict = 'wrong' AND true_category IS NOT NULL AND true_category NOT IN ('spam', 'notification')))
    GROUP BY addr
  `.execute(db);

  // The user's own mail (not system sends, not automatic replies) to each address in To or Cc, once per mail.
  const sent = await sql<SentRow>`
    SELECT lower(btrim(a.addr)) AS addr, count(DISTINCT s.id)::int AS n, max(s.internal_date) AS last_at
    FROM sent_emails s
    CROSS JOIN LATERAL unnest(s.to_addresses || s.cc_addresses) AS a(addr)
    WHERE s.org_id = ${ctx.orgId}
      AND s.mailbox_id = ${mailboxId}
      AND s.origin = 'user'
      AND s.internal_date >= ${since}
      AND s.internal_date <= ${now}
      AND ${notAutomatic("s.auto_submitted")}
      AND a.addr LIKE '%@%'
    GROUP BY lower(btrim(a.addr))
  `.execute(db);

  // The user's delay is the first Sent reply after the mail whose `parent_message_id` is the Message-ID of the mail; it goes
  // to the sender (or has no stored recipient). A delay of 0 or less (clock skew) is no sample.
  const userDelays = await sql<DelayRow>`
    WITH win AS (${win})
    SELECT addr, count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS median
    FROM (
      SELECT w.addr, extract(epoch FROM (r.sent_at - w.received_at)) / 3600 AS hours
      FROM win w
      JOIN LATERAL (
        SELECT s.sent_at
        FROM sent_emails s
        WHERE s.org_id = ${ctx.orgId}
          AND s.mailbox_id = ${mailboxId}
          AND s.origin = 'user'
          AND s.parent_message_id = w.message_id_header
          AND s.sent_at > w.received_at
          AND ${notAutomatic("s.auto_submitted")}
          AND (cardinality(s.to_addresses || s.cc_addresses) = 0 OR (s.to_addresses || s.cc_addresses) && ARRAY[w.addr])
        ORDER BY s.sent_at, s.id
        LIMIT 1
      ) r ON true
    ) d
    WHERE hours > 0 AND hours <= ${MAX_DELAY_HOURS}
    GROUP BY addr
  `.execute(db);

  // Their delay is the time from a Sent mail to the incoming mail that names its Message-ID in In-Reply-To (a whole id, as
  // `replyMatch`; `<id>` tokens when there are any, else bare words). One sample per incoming mail: the newest Sent mail it names.
  const theirDelays = await sql<DelayRow>`
    WITH win AS (${win}), own_sent AS MATERIALIZED (
      SELECT s.id, s.sent_at, regexp_replace(btrim(s.message_id), '^<|>$', '', 'g') AS ref
      FROM sent_emails s
      WHERE s.org_id = ${ctx.orgId} AND s.mailbox_id = ${mailboxId} AND s.origin = 'user' AND s.message_id IS NOT NULL
    ), named AS MATERIALIZED (
      SELECT w.id, w.addr, w.received_at, t.id AS ref
      FROM win w
      CROSS JOIN LATERAL unnest(
        COALESCE(
          NULLIF(ARRAY(SELECT m[1] FROM regexp_matches(left(w.in_reply_to, 2000), '<([^<>[:space:]]+)>', 'g') AS m), '{}'),
          ARRAY(
            SELECT x FROM unnest(regexp_split_to_array(btrim(left(w.in_reply_to, 2000)), '[[:space:]]+')) AS x
            WHERE x <> '' AND x !~ '[<>]'
          )
        )
      ) AS t(id)
      WHERE w.in_reply_to IS NOT NULL
    )
    SELECT addr, count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS median
    FROM (
      SELECT DISTINCT ON (n.id) n.addr, extract(epoch FROM (n.received_at - s.sent_at)) / 3600 AS hours
      FROM named n
      JOIN own_sent s ON s.ref = n.ref AND s.sent_at < n.received_at
      ORDER BY n.id, s.sent_at DESC, s.id
    ) d
    WHERE hours > 0 AND hours <= ${MAX_DELAY_HOURS}
    GROUP BY addr
  `.execute(db);

  const delegations = await sql<DelegationRow>`
    SELECT lower(btrim(d.email)) AS addr, count(*)::int AS n
    FROM delegations dn
    JOIN delegates d ON d.id = dn.delegate_id AND d.org_id = dn.org_id
    WHERE dn.org_id = ${ctx.orgId}
      AND dn.mailbox_id = ${mailboxId}
      AND dn.created_at >= ${since}
      AND dn.created_at <= ${now}
      AND d.active
    GROUP BY lower(btrim(d.email))
  `.execute(db);

  const testSenders = new Set(testMail.senders.map((address) => address.trim().toLowerCase()));
  const byAddress = new Map<string, SenderActivity>();
  const entry = (address: string): SenderActivity | null => {
    if (own.has(address) || testSenders.has(address)) return null;
    let value = byAddress.get(address);
    if (value === undefined) {
      value = emptyActivity(address);
      byAddress.set(address, value);
    }
    return value;
  };

  for (const row of mails.rows) {
    const item = entry(row.addr);
    if (item === null) continue;
    const noreply = isNoreplyAddress(row.addr);
    item.received = row.received;
    item.received30 = row.received30;
    item.answered = row.answered;
    item.answered30 = row.answered30;
    item.flagged = row.flagged;
    item.flagged30 = row.flagged30;
    item.unseen7d = row.unseen7d;
    item.suspicious90 = row.suspicious;
    item.firstSeenAt = row.first_at;
    item.lastSeenAt = row.last_at;
    // A noreply sender is bulk on every mail, whatever the age of its headers.
    item.bulkBase = noreply ? row.received : row.hdr_ok;
    item.bulkMails = noreply ? row.received : row.hdr_bulk;
    item.bulkSignals = [
      ...(row.sig_list_id ? (["list_id"] as const) : []),
      ...(row.sig_list_unsubscribe ? (["list_unsubscribe"] as const) : []),
      ...(noreply ? (["noreply"] as const) : []),
      ...(row.sig_auto_submitted ? (["auto_submitted"] as const) : []),
    ];
  }
  for (const row of categories.rows) {
    const item = byAddress.get(row.addr);
    if (item !== undefined) item.byCategory[categorySchema.parse(row.category)] = row.n;
  }
  for (const row of feedback.rows) {
    const item = byAddress.get(row.addr);
    if (item === undefined) continue;
    if (row.kind === "correction" && row.category !== null) {
      const category = categorySchema.parse(row.category);
      item.corrections[category] = row.n;
      if (category === "spam") item.correctedToSpam90 = row.n;
    } else if (row.kind === "moved_back") item.movedBack = row.n;
    else if (row.kind === "rescued") item.rescued90 = row.n;
  }
  for (const row of sent.rows) {
    const item = entry(row.addr);
    if (item === null) continue;
    item.userMailsTo = row.n;
    item.lastUserMailAt = row.last_at;
  }
  for (const row of userDelays.rows) {
    const item = byAddress.get(row.addr);
    if (item !== undefined && row.n >= MIN_DELAY_SAMPLES) item.medianUserReplyHours = row.median;
  }
  for (const row of theirDelays.rows) {
    const item = byAddress.get(row.addr);
    if (item === undefined) continue;
    item.replySamplesTheirs = row.n;
    if (row.n >= MIN_DELAY_SAMPLES) item.medianTheirReplyHours = row.median;
  }
  for (const row of delegations.rows) {
    const item = byAddress.get(row.addr);
    if (item !== undefined) item.delegationsTo = row.n;
  }

  for (const item of byAddress.values()) {
    item.relation = relationOf({
      isDelegate: delegateEmails.has(item.address),
      isVip: matchSender(item.address, rules).vip,
      received: item.bulkBase,
      bulkMails: item.bulkMails,
      answered: item.answered,
      userMailsTo: item.userMailsTo,
    });
  }
  return [...byAddress.values()].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
}
