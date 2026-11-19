import type { ReplyOutcomeRows, ReplyRequestEndRow, WeekQuery } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";
import { listReplyPairRows } from "../../actions";
import { mailKindFilter } from "../../mail";

type DbOrTrx = Db | Transaction<DB>;

// The requests of real mail that ended in the range with no draft: the model answered "no draft" (`no_draft`) or the request failed
// (`failed`). A sample is not a request for a draft. The end time is `updated_at` (retention never moves it). Status codes only.
async function listRequestEndRows(db: DbOrTrx, ctx: TenantContext, q: WeekQuery): Promise<ReplyRequestEndRow[]> {
  let query = db
    .selectFrom("reply_requests as r")
    .innerJoin("emails", (join) => join.onRef("emails.id", "=", "r.email_id").onRef("emails.org_id", "=", "r.org_id"))
    .select("r.status")
    .where("r.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("r.trigger", "<>", "sample")
    .where("r.status", "in", ["no_draft", "failed"])
    .where("r.updated_at", ">=", q.range.start)
    .where("r.updated_at", "<", q.range.end)
    .where(mailKindFilter("real", q.testMail));
  if (q.mailboxId !== null) query = query.where("r.mailbox_id", "=", q.mailboxId);
  const rows = await query.orderBy("r.updated_at").orderBy("r.id").execute();
  return rows.flatMap((row) => (row.status === "no_draft" || row.status === "failed" ? [{ status: row.status }] : []));
}

/**
 * The rows behind the reply draft counts of a week (`replyOutcomeCounts`): the pairs made in the range, each as its newest version
 * stands now, and the requests that ended with no draft. Every read holds the `org_id` of the context.
 */
export async function replyOutcomeRows(db: DbOrTrx, ctx: TenantContext, q: WeekQuery): Promise<ReplyOutcomeRows> {
  const [pairs, requests] = await Promise.all([listReplyPairRows(db, ctx, q), listRequestEndRows(db, ctx, q)]);
  return { pairs, requests };
}
