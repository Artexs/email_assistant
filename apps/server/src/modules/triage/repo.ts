import { categorySchema, type Category, type FeedbackSource } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

export interface TriageResultInput {
  emailId: string;
  category: Category;
  vip: boolean;
  confidence: number;
  reasonCode: string;
  reason: string | null;
  fields: Record<string, unknown>;
  model: string | null;
  promptVersion: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
}

export interface LatestTriageResult {
  id: string;
  category: Category;
  confidence: number;
  reason_code: string;
  model: string | null;
  fields: unknown;
}

export interface FeedbackInput {
  emailId: string;
  verdict: "right" | "wrong";
  trueCategory: Category | null;
  source: FeedbackSource;
  userId: string | null;
}

// The foreign key (email_id, org_id) rejects an email of another org.
export async function insertTriageResult(db: DbOrTrx, ctx: TenantContext, row: TriageResultInput): Promise<string> {
  const inserted = await db
    .insertInto("triage_results")
    .values({
      org_id: ctx.orgId,
      email_id: row.emailId,
      category: row.category,
      vip: row.vip,
      confidence: row.confidence,
      reason_code: row.reasonCode,
      reason: row.reason,
      fields: JSON.stringify(row.fields),
      model: row.model,
      prompt_version: row.promptVersion,
      tokens_in: row.tokensIn,
      tokens_out: row.tokensOut,
      latency_ms: row.latencyMs,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

// Newest first; `id` breaks a tie of `created_at` (rows of one transaction share `now()`).
export async function latestTriageResult(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<LatestTriageResult | undefined> {
  const row = await db
    .selectFrom("triage_results")
    .select(["id", "category", "confidence", "reason_code", "model", "fields"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return { ...row, category: categorySchema.parse(row.category) };
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
