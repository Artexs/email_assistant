import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

// D7 (ticket F115): is there a newer mail in the thread of this mail? "Newer" is by `received_at`, then by id (the same order as the thread
// rule of the drafter). The mail must be in the same mailbox and have the same `thread_key`. An automatic mail does not count: `Auto-Submitted`
// set to anything but `no` (an out-of-office is no answer to the question). Every other mail counts, whatever its sender or category,
// also a mail from an own mailbox. A mail with no headers row is not automatic. A mail of another organization or an unknown id gives
// false. Every table in the query is filtered by `org_id`. The text of the mail is never read.
export async function newerMailInThread(db: DbOrTrx, ctx: TenantContext, emailId: string): Promise<boolean> {
  const row = await db
    .selectFrom("emails as e")
    .innerJoin("emails as n", (join) =>
      join
        .onRef("n.org_id", "=", "e.org_id")
        .onRef("n.mailbox_id", "=", "e.mailbox_id")
        .onRef("n.thread_key", "=", "e.thread_key")
        .on("n.id", "<>", sql.ref("e.id"))
    )
    .leftJoin("email_headers as h", (join) => join.onRef("h.email_id", "=", "n.id").onRef("h.org_id", "=", "n.org_id"))
    .select("n.id")
    .where("e.org_id", "=", ctx.orgId)
    .where("e.id", "=", emailId)
    .where("n.org_id", "=", ctx.orgId)
    .where(sql<boolean>`(n.received_at > e.received_at OR (n.received_at = e.received_at AND n.id > e.id))`)
    .where(
      sql<boolean>`(h.auto_submitted IS NULL OR btrim(h.auto_submitted) = '' OR lower(btrim(split_part(h.auto_submitted, ';', 1))) = 'no')`
    )
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
