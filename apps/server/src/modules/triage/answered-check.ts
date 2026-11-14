import { categorySchema, type AnsweredItem, type Category } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { getEmailFlags, mailKindFilter, setAnsweredCheck, type TestMailRule } from "../mail";

import { recordFeedback } from "./feedback";
import { getLabelTarget } from "./repo";

type DbOrTrx = Db | Transaction<DB>;

// How far back the answered check looks (the `/review` block).
export const ANSWERED_CHECK_WINDOW_MS = 14 * 24 * 3_600_000;

// The categories the assistant did not treat as "needs reply".
const QUIET_CATEGORIES = ["info", "notification", "spam"] as const satisfies readonly Category[];

// Real mail with a flag read that says "answered" (a "last tried" row has `answered` false), the latest triage result in a
// quiet category, no feedback row and no answer yet. `emails` is the table name the mail kind filter needs.
function candidateFilter(ctx: TenantContext, since: Date, testMail: TestMailRule) {
  return sql`emails.org_id = ${ctx.orgId}
    AND emails.received_at >= ${since}
    AND f.answered
    AND f.answered_check IS NULL
    AND t.category IN (${sql.join(QUIET_CATEGORIES)})
    AND ${mailKindFilter("real", testMail)}
    AND NOT EXISTS (
      SELECT 1 FROM triage_feedback tf WHERE tf.org_id = ${ctx.orgId} AND tf.email_id = emails.id
    )`;
}

function candidateFrom(ctx: TenantContext) {
  return sql`FROM emails
    JOIN email_flags f ON f.email_id = emails.id AND f.org_id = emails.org_id
    JOIN LATERAL (
      SELECT tr.category
      FROM triage_results tr
      WHERE tr.org_id = ${ctx.orgId} AND tr.email_id = emails.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) t ON true`;
}

const candidateSchema = z.object({
  id: z.string(),
  from_address: z.string().nullable(),
  subject: z.string().nullable(),
  received_at: z.date(),
  category: categorySchema,
});

/** Mails the user answered that the assistant did not mark "needs reply", oldest received first. */
export async function listAnsweredCandidates(
  db: DbOrTrx,
  ctx: TenantContext,
  q: { mailboxIds: readonly string[]; since: Date; limit: number; testMail: TestMailRule }
): Promise<AnsweredItem[]> {
  if (q.mailboxIds.length === 0) return [];
  const { rows } = await sql<unknown>`
    SELECT emails.id, emails.from_address, emails.subject, emails.received_at, t.category
    ${candidateFrom(ctx)}
    WHERE ${candidateFilter(ctx, q.since, q.testMail)}
      AND emails.mailbox_id IN (${sql.join(q.mailboxIds)})
    ORDER BY emails.received_at, emails.id
    LIMIT ${q.limit}
  `.execute(db);
  return rows.map((raw) => {
    const row = candidateSchema.parse(raw);
    return {
      emailId: row.id,
      category: row.category,
      from: row.from_address,
      subject: row.subject,
      receivedAt: row.received_at,
    };
  });
}

/** The same filter, counted over all mailboxes of the organization (the weekly report line). */
export async function countAnsweredWaiting(
  db: DbOrTrx,
  ctx: TenantContext,
  q: { since: Date; testMail: TestMailRule }
): Promise<number> {
  const { rows } = await sql<{ n: string }>`
    SELECT count(*) AS n
    ${candidateFrom(ctx)}
    WHERE ${candidateFilter(ctx, q.since, q.testMail)}
  `.execute(db);
  return Number(rows[0]?.n ?? 0);
}

export type AnsweredResult = { kind: "yes" } | { kind: "no" } | { kind: "already" } | { kind: "not_found" };

/**
 * One transaction: the answer, and on "yes" the label `needs_reply` (source `answered_check`). A mail with no flag read that
 * says "answered", or with no triage result, is `not_found`; a mail that has an answer is `already`.
 */
export async function answerAnsweredCheck(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { emailId: string; answer: "yes" | "no"; userId: string; now: Date }
): Promise<AnsweredResult> {
  const run = async (trx: Transaction<DB>): Promise<AnsweredResult> => {
    const flags = await getEmailFlags(trx, ctx, input.emailId);
    if (flags === undefined || !flags.answered) return { kind: "not_found" };
    if (flags.answeredCheck !== null) return { kind: "already" };
    if ((await getLabelTarget(trx, ctx, input.emailId)) === undefined) return { kind: "not_found" };
    const wrote = await setAnsweredCheck(trx, ctx, input.emailId, {
      answer: input.answer,
      userId: input.userId,
      at: input.now,
    });
    if (!wrote) return { kind: "already" };
    if (input.answer === "yes") {
      await recordFeedback(trx, ctx, {
        emailId: input.emailId,
        trueCategory: "needs_reply",
        source: "answered_check",
        userId: input.userId,
        skipIfSame: true,
      });
    }
    return { kind: input.answer };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
