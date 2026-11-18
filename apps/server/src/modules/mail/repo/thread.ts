import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import { notAutomaticSql, type DbOrTrx } from "./shared";

// D7 (ticket F115): is there a newer mail in the thread of this mail? "Newer" is by `received_at`, then by id (the same order as the thread
// rule of the drafter). The mail must be in the same mailbox and have the same `thread_key`. An automatic mail does not count: `Auto-Submitted`
// set to anything but `no` (an out-of-office is no answer to the question). A mail in the junk folder or the trash folder of the mailbox
// (by its folder or its source folder), and a mail whose newest triage result is `spam`, does not count either: junk must not close a reply.
// Every other mail counts, whatever its sender or category, also a mail from an own mailbox. A mail with no headers row is not automatic. A mail of another organization or an unknown id gives
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
    .where(sql<boolean>`${sql.raw(notAutomaticSql("h.auto_submitted"))}`)
    .where(
      sql<boolean>`NOT EXISTS (
        SELECT 1 FROM mailbox_folders f
        WHERE f.org_id = n.org_id AND f.mailbox_id = n.mailbox_id AND f.role = 'junk' AND (n.folder = f.path OR n.source_folder = f.path)
      )`
    )
    .where(
      sql<boolean>`NOT EXISTS (
        SELECT 1 FROM mailboxes m WHERE m.org_id = n.org_id AND m.id = n.mailbox_id AND m.folder_map->>'trash' = n.folder
      )`
    )
    .where(
      sql<boolean>`NOT COALESCE((
        SELECT t.category = 'spam' FROM triage_results t WHERE t.org_id = n.org_id AND t.email_id = n.id
        ORDER BY t.created_at DESC, t.id DESC LIMIT 1
      ), false)`
    )
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
