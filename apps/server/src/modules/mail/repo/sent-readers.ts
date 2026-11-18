import { registrableDomain } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";
import { HardError } from "../../../platform/errors";

import { getSentSyncState, isSentErrorCode, type SentErrorCode } from "./sent-state";
import { notAutomaticSql, type DbOrTrx } from "./shared";

const ANSWER_CHUNK = 500;

export interface UserAnswer {
  answeredAt: Date;
  sentEmailId: string;
}

// The earliest reply of the user to each incoming mail: a user row of the same mailbox, in any Sent folder, whose parent id is the
// mail's Message-ID. A system send never counts. It must also go to the sender of the mail or to its Reply-To (a forward to a colleague
// that keeps the thread headers is no answer), and it must not be automatic (`Auto-Submitted` other than `no`: a vacation reply is no
// answer). A row whose recipients were cleared by the retention is not judged by the recipient rule. The order is the send time, then the row id. Ids without a reply are absent.
// `settledOnly`: a row whose text step has not run (`content = 'pending'`) and that has no stored `Auto-Submitted` does not count yet: its
// header is unknown, so it may be a vacation reply. The sweep sets it (it reads no mailbox; the row counts once the sync reads it).
export async function listUserAnswers(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[],
  opts: { settledOnly?: boolean } = {}
): Promise<Map<string, UserAnswer>> {
  const answers = new Map<string, UserAnswer>();
  for (let start = 0; start < emailIds.length; start += ANSWER_CHUNK) {
    const chunk = emailIds.slice(start, start + ANSWER_CHUNK);
    const rows = await db
      .selectFrom("emails as e")
      .innerJoin("sent_emails as s", (join) =>
        join
          .onRef("s.org_id", "=", "e.org_id")
          .onRef("s.mailbox_id", "=", "e.mailbox_id")
          .onRef("s.parent_message_id", "=", "e.message_id_header")
      )
      .leftJoin("email_headers as h", (join) =>
        join.onRef("h.email_id", "=", "e.id").onRef("h.org_id", "=", "e.org_id")
      )
      .distinctOn("e.id")
      .select(["e.id as emailId", "s.id as sentEmailId", "s.sent_at as answeredAt"])
      .where("e.org_id", "=", ctx.orgId)
      .where("e.id", "in", chunk)
      .where("s.org_id", "=", ctx.orgId)
      .where("s.origin", "=", "user")
      // One recipient of the Sent mail (To or Cc) is the sender of the mail or an address of its Reply-To. Stored addresses are lower case.
      // A row with no stored recipient (the retention cleared its headers, or the mail had only Bcc) cannot be judged and counts as before.
      .where(
        sql<boolean>`(
          cardinality(s.to_addresses || s.cc_addresses) = 0
          OR (s.to_addresses || s.cc_addresses) && (ARRAY[e.from_address_lower] || COALESCE(h.reply_to, '{}'::text[]))
        )`
      )
      .where(sql<boolean>`${sql.raw(notAutomaticSql("s.auto_submitted"))}`)
      .$if(opts.settledOnly === true, (qb) =>
        qb.where(sql<boolean>`NOT (s.content = 'pending' AND s.auto_submitted IS NULL)`)
      )
      .orderBy("e.id")
      .orderBy("s.sent_at")
      .orderBy("s.id")
      .execute();
    for (const row of rows) answers.set(row.emailId, { answeredAt: row.answeredAt, sentEmailId: row.sentEmailId });
  }
  return answers;
}

export interface SentSummary {
  userCount: number;
  newestUserAt: Date | null;
}

// User mail in the current Sent folder of the mailbox: the count since `since` and the newest INTERNALDATE of any age.
// No state or no folder path: nothing was read.
export async function getSentSummary(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date }
): Promise<SentSummary> {
  const state = await getSentSyncState(db, ctx, mailboxId);
  if (state === undefined || state.path === null) return { userCount: 0, newestUserAt: null };
  const row = await db
    .selectFrom("sent_emails")
    .select((eb) => [
      eb.fn.countAll().filterWhere("internal_date", ">=", opts.since).as("userCount"),
      eb.fn.max("internal_date").as("newestUserAt"),
    ])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("origin", "=", "user")
    .where("path", "=", state.path)
    .executeTakeFirstOrThrow();
  return { userCount: Number(row.userCount), newestUserAt: row.newestUserAt };
}

export interface SentHealthRow {
  mailboxId: string;
  firstPassAt: Date;
  lastPassAt: Date | null;
  newestUserAt: Date | null;
  lastErrorCode: SentErrorCode | null;
}

// One row per mailbox of the organization with the switch on and a finished first pass.
export async function listSentHealth(db: DbOrTrx, ctx: TenantContext): Promise<SentHealthRow[]> {
  const rows = await db
    .selectFrom("mailbox_sent_sync as st")
    .select((eb) => [
      "st.mailbox_id",
      "st.first_pass_at",
      "st.last_pass_at",
      "st.last_error_code",
      eb
        .selectFrom("sent_emails as s")
        .select((sub) => sub.fn.max("s.internal_date").as("newest"))
        .whereRef("s.org_id", "=", "st.org_id")
        .whereRef("s.mailbox_id", "=", "st.mailbox_id")
        .whereRef("s.path", "=", "st.path")
        .where("s.origin", "=", "user")
        .as("newestUserAt"),
    ])
    .where("st.org_id", "=", ctx.orgId)
    .where("st.enabled", "=", true)
    .where("st.first_pass_at", "is not", null)
    .orderBy("st.mailbox_id")
    .execute();
  return rows.map((row) => {
    if (row.first_pass_at === null) throw new HardError("a sent health row has no first pass");
    if (row.last_error_code !== null && !isSentErrorCode(row.last_error_code)) {
      throw new HardError("mailbox_sent_sync row has an unknown error code");
    }
    return {
      mailboxId: row.mailbox_id,
      firstPassAt: row.first_pass_at,
      lastPassAt: row.last_pass_at,
      newestUserAt: row.newestUserAt,
      lastErrorCode: row.last_error_code,
    };
  });
}

export interface SentRecipientDomain {
  // The registrable domain (lower case, `registrableDomain` of core).
  domain: string;
  // Distinct user mails with a recipient on this domain.
  mails: number;
}

// The registrable domains that the user wrote to: To or Cc of `origin = 'user'` Sent mail of this mailbox with `sent_at` at or after
// `since`, not an automatic reply, counted once per mail. Only domains with at least `minMails` mails; the most mailed first
// (ties by name), at most `limit`. One statement. A mail that has two recipients on subdomains of one registrable domain counts
// once for that domain. A recipient with no domain, and a row whose recipients the retention cleared, count for nothing. The
// result holds domains and counts only, never an address.
export async function sentRecipientDomains(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; minMails: number; limit: number }
): Promise<SentRecipientDomain[]> {
  const { rows } = await sql<{ id: string; host: string }>`
    SELECT DISTINCT s.id, lower(btrim(substring(a.addr FROM '@([^@]*)$'))) AS host
    FROM sent_emails s
    CROSS JOIN LATERAL unnest(s.to_addresses || s.cc_addresses) AS a(addr)
    WHERE s.org_id = ${ctx.orgId}
      AND s.mailbox_id = ${mailboxId}
      AND s.origin = 'user'
      AND s.sent_at >= ${opts.since}
      AND ${sql.raw(notAutomaticSql("s.auto_submitted"))}
      AND a.addr LIKE '%@%'
  `.execute(db);
  const mailsOf = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.host === "") continue;
    const domain = registrableDomain(row.host);
    if (domain === "") continue;
    const ids = mailsOf.get(domain) ?? new Set<string>();
    ids.add(row.id);
    mailsOf.set(domain, ids);
  }
  return [...mailsOf]
    .map(([domain, ids]) => ({ domain, mails: ids.size }))
    .filter((row) => row.mails >= opts.minMails)
    .sort((a, b) => b.mails - a.mails || (a.domain < b.domain ? -1 : 1))
    .slice(0, opts.limit);
}
