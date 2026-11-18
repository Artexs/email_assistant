import {
  categorySchema,
  feedbackSources,
  feedbackVerdicts,
  type Category,
  type FeedbackSource,
  type FeedbackVerdict,
} from "@ea/core";
import { z } from "zod";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

export interface FeedbackInput {
  emailId: string;
  verdict: FeedbackVerdict;
  trueCategory: Category | null;
  source: FeedbackSource;
  userId: string | null;
}
export async function insertFeedback(db: DbOrTrx, ctx: TenantContext, row: FeedbackInput): Promise<string> {
  const inserted = await db
    .insertInto("triage_feedback")
    .values({
      org_id: ctx.orgId,
      email_id: row.emailId,
      verdict: row.verdict,
      true_category: row.trueCategory,
      source: row.source,
      user_id: row.userId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}
export const verdictSchema = z.enum(feedbackVerdicts);
// Newest first; on a `created_at` tie `id` gives a stable order, the same as `listLabeledResults`.
export async function latestFeedback(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<{ id: string; verdict: FeedbackVerdict; true_category: Category | null } | undefined> {
  const row = await db
    .selectFrom("triage_feedback")
    .select(["id", "verdict", "true_category"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    verdict: verdictSchema.parse(row.verdict),
    true_category: row.true_category === null ? null : categorySchema.parse(row.true_category),
  };
}
export interface LatestFeedbackRow {
  verdict: FeedbackVerdict;
  true_category: Category | null;
  source: FeedbackSource;
  created_at: Date;
}
const feedbackSourceSchema = z.enum(feedbackSources);
// The latest feedback row per mail (created_at desc, id desc), in chunks of 500 ids.
export async function listLatestFeedbackByEmailIds(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, LatestFeedbackRow>> {
  const out = new Map<string, LatestFeedbackRow>();
  for (let i = 0; i < emailIds.length; i += 500) {
    const rows = await db
      .selectFrom("triage_feedback")
      .distinctOn("email_id")
      .select(["email_id", "verdict", "true_category", "source", "created_at"])
      .where("org_id", "=", ctx.orgId)
      .where("email_id", "in", emailIds.slice(i, i + 500))
      .orderBy("email_id")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute();
    for (const row of rows) {
      out.set(row.email_id, {
        verdict: verdictSchema.parse(row.verdict),
        true_category: row.true_category === null ? null : categorySchema.parse(row.true_category),
        source: feedbackSourceSchema.parse(row.source),
        created_at: row.created_at,
      });
    }
  }
  return out;
}
