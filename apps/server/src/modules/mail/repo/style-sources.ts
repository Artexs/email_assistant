import type { StyleSource } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";
import type { TestMailRule } from "../seed";

import { sentTestMailFilter } from "./sent-test-mail";
import { notAutomaticSql, type DbOrTrx } from "./shared";

// The own mail of the user that the style suggestion reads: `origin = user` rows of one mailbox whose text is stored, from `since` on,
// newest first (`internal_date`, then id), at most `limit`. A mail that is no personal writing is left out: an automatic reply, a list or
// bulk mail, a calendar invite, and a draft of the system that the user sent (`action_id` is set: it is not the user's own style).
// `testOnly`: only test mail (the synthetic scope of the LLM: a real mail never goes to the model there). Reads only.
export async function listStyleSources(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; limit: number; testOnly: TestMailRule | null }
): Promise<StyleSource[]> {
  const rows = await db
    .selectFrom("sent_emails as s")
    .select(["s.body_text", "s.to_addresses", "s.cc_addresses"])
    .where("s.org_id", "=", ctx.orgId)
    .where("s.mailbox_id", "=", mailboxId)
    .where("s.origin", "=", "user")
    .where("s.content", "=", "stored")
    .where("s.body_text", "is not", null)
    .where("s.internal_date", ">=", opts.since)
    .where(sql<boolean>`${sql.raw(notAutomaticSql("s.auto_submitted"))}`)
    .where("s.list_id", "is", null)
    .where(sql<boolean>`(s.precedence IS NULL OR lower(btrim(s.precedence)) NOT IN ('bulk', 'list', 'junk'))`)
    .where("s.has_calendar", "is distinct from", true)
    .where("s.action_id", "is", null)
    .$if(opts.testOnly !== null, (qb) => qb.where(sentTestMailFilter(opts.testOnly ?? { senders: [] })))
    .orderBy("s.internal_date", "desc")
    .orderBy("s.id", "desc")
    .limit(opts.limit)
    .execute();
  return rows.flatMap((row) =>
    row.body_text === null
      ? []
      : [{ bodyText: row.body_text, toAddresses: row.to_addresses, ccAddresses: row.cc_addresses }]
  );
}
