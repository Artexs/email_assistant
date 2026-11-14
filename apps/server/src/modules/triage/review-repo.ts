import { categorySchema } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { mailKindFilter, type TestMailRule } from "../mail";

import type { UnlabeledResult } from "./repo";

// The Telegram /review page (F097 D4): its size and how far back it looks.
export const REVIEW_PAGE_SIZE = 10;
export const REVIEW_WINDOW_DAYS = 30;

type DbOrTrx = Db | Transaction<DB>;

// One row per mail (its latest triage result), no feedback row, real mail only (D1 rule), received since `since`.
// Order: md5(email_id::text || seed), then email_id, so one seed always gives one order and a new seed gives a new sample.
export async function listReviewSample(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { mailboxIds: readonly string[]; since: Date; seed: string; limit: number; testMail: TestMailRule }
): Promise<UnlabeledResult[]> {
  if (input.mailboxIds.length === 0) {
    return [];
  }
  const rows = await db
    .selectFrom((qb) =>
      qb
        .selectFrom("triage_results")
        .innerJoin("emails", (join) =>
          join.onRef("emails.id", "=", "triage_results.email_id").onRef("emails.org_id", "=", "triage_results.org_id")
        )
        .distinctOn("triage_results.email_id")
        .select([
          "triage_results.email_id",
          "emails.received_at",
          "emails.from_address",
          "emails.subject",
          "triage_results.category",
          "triage_results.confidence",
          "triage_results.reason_code",
          "triage_results.fields",
        ])
        .where("triage_results.org_id", "=", ctx.orgId)
        .where("emails.org_id", "=", ctx.orgId)
        .where("emails.mailbox_id", "in", input.mailboxIds)
        .where("emails.received_at", ">=", input.since)
        .where(mailKindFilter("real", input.testMail))
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom("triage_feedback")
                .select("triage_feedback.id")
                .whereRef("triage_feedback.email_id", "=", "triage_results.email_id")
                .where("triage_feedback.org_id", "=", ctx.orgId)
            )
          )
        )
        .orderBy("triage_results.email_id")
        .orderBy("triage_results.created_at", "desc")
        .orderBy("triage_results.id", "desc")
        .as("latest")
    )
    .selectAll()
    .orderBy(sql<string>`md5(${sql.ref("email_id")}::text || ${input.seed})`)
    .orderBy("email_id")
    .limit(input.limit)
    .execute();
  return rows.map((row) => ({ ...row, category: categorySchema.parse(row.category) }));
}
