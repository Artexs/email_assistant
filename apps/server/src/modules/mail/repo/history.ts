// Readers of the history check: the sample candidates, one stored mail for the classifier and the flag facts of mail.
// Ids, times and booleans leave here; the one reader that returns text (`getStoredEmail`) feeds the classifier only.
import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";
import type { TestMailRule } from "../seed";

import type { ClaimedEmail } from "./claims";
import { mailKindFilter } from "./emails";
import type { DbOrTrx } from "./shared";

const IN_CHUNK = 500;

/** The mail of one id as the classifier reads it: the fields of a claimed mail without the claim. */
export type StoredEmail = Omit<ClaimedEmail, "locked_at" | "attempts" | "next_attempt_at">;

export async function getStoredEmail(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<StoredEmail | undefined> {
  return db
    .selectFrom("emails")
    .select([
      "id",
      "mailbox_id",
      "backfilled_at",
      "created_at",
      "received_at",
      "from_address",
      "to_addresses",
      "cc_addresses",
      "subject",
      "body_text",
      "thread_key",
      "message_id_header",
      "in_reply_to",
      "references_header",
      "source_folder",
    ])
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .executeTakeFirst();
}

export interface HistoryCandidate {
  id: string;
  receivedAt: Date;
  /** `md5(check id || mail id)`: the seeded order of the fill. */
  hash: string;
}

/**
 * The mail that the history check may classify: INBOX mail received from `since` on, with its body (retention has not
 * cleared it), not written by the mailbox itself. `scope` `synthetic` keeps test mail only (`TRIAGE_LLM_SCOPE`). Newest first; the
 * caller sorts and cuts.
 */
export async function listHistoryCandidates(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; checkId: string; scope: false | { testMail: TestMailRule } }
): Promise<HistoryCandidate[]> {
  let query = db
    .selectFrom("emails")
    .innerJoin("mailboxes", (join) =>
      join.onRef("mailboxes.id", "=", "emails.mailbox_id").onRef("mailboxes.org_id", "=", "emails.org_id")
    )
    .select(["emails.id", "emails.received_at", sql<string>`md5(${opts.checkId}::text || emails.id::text)`.as("hash")])
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.mailbox_id", "=", mailboxId)
    .where("emails.source_folder", "=", "INBOX")
    .where("emails.received_at", ">=", opts.since)
    .where("emails.body_text", "is not", null)
    .where((eb) =>
      eb.or([
        eb("emails.from_address_lower", "is", null),
        eb("emails.from_address_lower", "!=", sql<string>`lower(mailboxes.address)`),
      ])
    );
  if (opts.scope !== false) query = query.where(mailKindFilter("synthetic", opts.scope.testMail));
  const rows = await query.orderBy("emails.received_at", "desc").orderBy("emails.id", "desc").execute();
  return rows.map((row) => ({ id: row.id, receivedAt: row.received_at, hash: row.hash }));
}

/** The mail of the list with the IMAP flag `\Answered` or `\Flagged` (the flags that the refresh read). */
export async function listAnsweredOrFlagged(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; from < emailIds.length; from += IN_CHUNK) {
    const rows = await db
      .selectFrom("email_flags")
      .select("email_id")
      .where("org_id", "=", ctx.orgId)
      .where("email_id", "in", emailIds.slice(from, from + IN_CHUNK))
      .where((eb) => eb.or([eb("answered", "=", true), eb("flagged", "=", true)]))
      .execute();
    for (const row of rows) out.add(row.email_id);
  }
  return out;
}

/** How many mails of the list have the flag `\Answered`. */
export async function countAnswered(db: DbOrTrx, ctx: TenantContext, emailIds: readonly string[]): Promise<number> {
  let total = 0;
  for (let from = 0; from < emailIds.length; from += IN_CHUNK) {
    const row = await db
      .selectFrom("email_flags")
      .select(sql<string>`count(*)`.as("n"))
      .where("org_id", "=", ctx.orgId)
      .where("email_id", "in", emailIds.slice(from, from + IN_CHUNK))
      .where("answered", "=", true)
      .executeTakeFirstOrThrow();
    total += Number(row.n);
  }
  return total;
}

/** The From addresses of the mail in the list (null: the mail has none). The classifier run reads the known senders once for them. */
export async function listFromAddresses(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (let from = 0; from < emailIds.length; from += IN_CHUNK) {
    const rows = await db
      .selectFrom("emails")
      .select("from_address")
      .where("org_id", "=", ctx.orgId)
      .where("id", "in", emailIds.slice(from, from + IN_CHUNK))
      .execute();
    out.push(...rows.map((row) => row.from_address));
  }
  return out;
}

export interface MailExampleFacts {
  receivedAt: Date;
  /** The display name of the sender; null: none, or the retention cleared it. */
  fromName: string | null;
  /** null after the retention cleared the subject. */
  subject: string | null;
}

/**
 * The facts of the trust report's examples: when the mail came, the sender's display name and the subject.
 * The panel shows them behind login; they never go to Telegram. A mail that is gone has no entry. The address is not read.
 */
export async function listMailExamples(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, MailExampleFacts>> {
  const found = new Map<string, MailExampleFacts>();
  for (let i = 0; i < emailIds.length; i += IN_CHUNK) {
    const rows = await db
      .selectFrom("emails")
      .leftJoin("email_headers", (join) =>
        join.onRef("email_headers.email_id", "=", "emails.id").onRef("email_headers.org_id", "=", "emails.org_id")
      )
      .select(["emails.id", "emails.received_at", "emails.subject", "email_headers.from_name"])
      .where("emails.org_id", "=", ctx.orgId)
      .where("emails.id", "in", emailIds.slice(i, i + IN_CHUNK))
      .execute();
    for (const row of rows) {
      found.set(row.id, { receivedAt: row.received_at, fromName: row.from_name, subject: row.subject });
    }
  }
  return found;
}
