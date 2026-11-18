import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";
import { mailKindFilter, type TestMailRule } from "../../mail";

type DbOrTrx = Db | Transaction<DB>;

const DAY_MS = 86_400_000;
// A mail older than this gets no automatic request (the rule `too_old` of the eligibility says the same).
export const SCAN_MAX_AGE_DAYS = 7;

export interface ReplyScanRow {
  emailId: string;
  threadKey: string;
  folder: string;
}

// The mail of one mailbox that needs an automatic reply request: triaged, the newest triage result is `needs_reply`, received in
// the last 7 days, and no `auto` request yet (the unique key of the table is the second guard). Oldest first, at most `limit`.
// `testOnly`: only test mail (the synthetic scope of the model: a real mail never goes to the model there).
// The caller checks the gates (flag, mode, switch, mailbox kind) first: this query reads mail only.
export async function scanReplyCandidates(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; testOnly: TestMailRule | null }
): Promise<ReplyScanRow[]> {
  const youngest = new Date(opts.now.getTime() - SCAN_MAX_AGE_DAYS * DAY_MS);
  let query = db
    .selectFrom("emails")
    .select(["emails.id", "emails.thread_key", "emails.folder"])
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.mailbox_id", "=", mailboxId)
    .where("emails.status", "=", "triaged")
    .where("emails.received_at", ">=", youngest)
    .where(
      sql<string | null>`(
        select t.category from triage_results t
        where t.org_id = emails.org_id and t.email_id = emails.id
        order by t.created_at desc, t.id desc limit 1)`,
      "=",
      "needs_reply"
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("reply_requests as r")
            .select("r.id")
            .whereRef("r.email_id", "=", "emails.id")
            .whereRef("r.org_id", "=", "emails.org_id")
            .where("r.trigger", "=", "auto")
        )
      )
    );
  if (opts.testOnly !== null) query = query.where(mailKindFilter("synthetic", opts.testOnly));
  const rows = await query.orderBy("emails.received_at").orderBy("emails.id").limit(opts.limit).execute();
  return rows.map((row) => ({ emailId: row.id, threadKey: row.thread_key, folder: row.folder }));
}

// True when the mail is test mail (a synthetic Message-ID, or a sender of the test rule).
export async function isTestMail(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  rule: TestMailRule
): Promise<boolean> {
  const row = await db
    .selectFrom("emails")
    .select("emails.id")
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.id", "=", emailId)
    .where(mailKindFilter("synthetic", rule))
    .executeTakeFirst();
  return row !== undefined;
}

// What the model reads of one mail. `bodyText` is null when retention cleared it or the body was never stored.
export interface MailTextForDraft {
  subject: string | null;
  fromName: string | null;
  bodyText: string | null;
}

export async function readMailTextForDraft(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<MailTextForDraft | undefined> {
  const row = await db
    .selectFrom("emails")
    .leftJoin("email_headers", (join) =>
      join.onRef("email_headers.email_id", "=", "emails.id").onRef("email_headers.org_id", "=", "emails.org_id")
    )
    .select(["emails.subject", "emails.body_text", "email_headers.from_name"])
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.id", "=", emailId)
    .executeTakeFirst();
  return row === undefined ? undefined : { subject: row.subject, fromName: row.from_name, bodyText: row.body_text };
}
