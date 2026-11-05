import { categorySchema, feedbackVerdicts, type Category, type FeedbackSource, type FeedbackVerdict } from "@ea/core";
import type { NotNull, Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { mailKindFilter, type MailKind } from "../mail";

type DbOrTrx = Db | Transaction<DB>;

export type { MailKind };

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

export interface UnlabeledResult {
  email_id: string;
  received_at: Date;
  from_address: string | null;
  subject: string | null;
  category: Category;
  confidence: number;
  reason_code: string;
  fields: unknown;
}

export interface LabeledResult {
  email_id: string;
  category: Category;
  confidence: number;
  reason_code: string;
  model: string | null;
  fields: unknown;
  verdict: FeedbackVerdict;
  true_category: Category | null;
}

export interface UsageRow {
  model: string;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  created_at: Date;
}

export interface FeedbackInput {
  emailId: string;
  verdict: FeedbackVerdict;
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

const verdictSchema = z.enum(feedbackVerdicts);

// The latest result per email with no feedback row, newest mail first.
export async function listUnlabeled(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { limit: number; mail: MailKind }
): Promise<UnlabeledResult[]> {
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
        .where("emails.mailbox_id", "=", mailboxId)
        .where(mailKindFilter(opts.mail))
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
    .orderBy("received_at", "desc")
    .orderBy("email_id", "desc")
    .limit(opts.limit)
    .execute();
  return rows.map((row) => ({ ...row, category: categorySchema.parse(row.category) }));
}

// The latest result and the latest feedback per email, for emails that have both.
export async function listLabeledResults(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { mail: MailKind }
): Promise<LabeledResult[]> {
  const rows = await db
    .with("latest_result", (qb) =>
      qb
        .selectFrom("triage_results")
        .innerJoin("emails", (join) =>
          join.onRef("emails.id", "=", "triage_results.email_id").onRef("emails.org_id", "=", "triage_results.org_id")
        )
        .distinctOn("triage_results.email_id")
        .select([
          "triage_results.email_id",
          "triage_results.category",
          "triage_results.confidence",
          "triage_results.reason_code",
          "triage_results.model",
          "triage_results.fields",
        ])
        .where("triage_results.org_id", "=", ctx.orgId)
        .where("emails.org_id", "=", ctx.orgId)
        .where("emails.mailbox_id", "=", mailboxId)
        .where(mailKindFilter(opts.mail))
        .orderBy("triage_results.email_id")
        .orderBy("triage_results.created_at", "desc")
        .orderBy("triage_results.id", "desc")
    )
    .with("latest_feedback", (qb) =>
      qb
        .selectFrom("triage_feedback")
        .distinctOn("triage_feedback.email_id")
        .select(["triage_feedback.email_id", "triage_feedback.verdict", "triage_feedback.true_category"])
        .where("triage_feedback.org_id", "=", ctx.orgId)
        .orderBy("triage_feedback.email_id")
        .orderBy("triage_feedback.created_at", "desc")
        .orderBy("triage_feedback.id", "desc")
    )
    .selectFrom("latest_result")
    .innerJoin("latest_feedback", "latest_feedback.email_id", "latest_result.email_id")
    .select([
      "latest_result.email_id",
      "latest_result.category",
      "latest_result.confidence",
      "latest_result.reason_code",
      "latest_result.model",
      "latest_result.fields",
      "latest_feedback.verdict",
      "latest_feedback.true_category",
    ])
    .orderBy("latest_result.email_id")
    .execute();
  return rows.map((row) => ({
    ...row,
    category: categorySchema.parse(row.category),
    verdict: verdictSchema.parse(row.verdict),
    true_category: row.true_category === null ? null : categorySchema.parse(row.true_category),
  }));
}

// Rows with a model (LLM results) created at or after `since`, oldest first.
export async function listUsageSince(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date,
  opts: { mail: MailKind }
): Promise<UsageRow[]> {
  return db
    .selectFrom("triage_results")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "triage_results.email_id").onRef("emails.org_id", "=", "triage_results.org_id")
    )
    .select([
      "triage_results.model",
      "triage_results.tokens_in",
      "triage_results.tokens_out",
      "triage_results.latency_ms",
      "triage_results.created_at",
    ])
    .where("triage_results.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.mailbox_id", "=", mailboxId)
    .where("triage_results.model", "is not", null)
    .where("triage_results.created_at", ">=", since)
    .where(mailKindFilter(opts.mail))
    .orderBy("triage_results.created_at")
    .orderBy("triage_results.id")
    .$narrowType<{ model: NotNull }>()
    .execute();
}
