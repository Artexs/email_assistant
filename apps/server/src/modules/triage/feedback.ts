import { categories, type Category, type FeedbackSource, type FeedbackVerdict } from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { listSummaries } from "../actions";

import { insertFeedback, latestTriageResult, listUnlabeled, type MailKind } from "./repo";

export interface RecordFeedbackInput {
  emailId: string;
  trueCategory?: Category;
  verdict?: FeedbackVerdict;
  source: FeedbackSource;
  userId?: string;
}

export interface LabelItem {
  emailId: string;
  receivedAt: Date;
  from: string | null;
  subject: string | null;
  category: Category;
  confidence: number;
  modelCategory: Category | null;
  summary: string | null;
}

// Every feedback source writes through this function. It never queues the mail for a new triage.
export async function recordFeedback(
  db: Db,
  ctx: TenantContext,
  input: RecordFeedbackInput
): Promise<{ id: string; verdict: FeedbackVerdict }> {
  if (input.trueCategory === undefined && input.verdict === undefined) {
    throw new HardError("feedback needs a true category or a verdict");
  }
  const latest = await latestTriageResult(db, ctx, input.emailId);
  if (!latest) {
    throw new HardError("email has no triage result");
  }
  const verdict: FeedbackVerdict =
    input.trueCategory === undefined
      ? (input.verdict as FeedbackVerdict)
      : input.trueCategory === latest.category
        ? "right"
        : "wrong";
  const id = await insertFeedback(db, ctx, {
    emailId: input.emailId,
    verdict,
    trueCategory: input.trueCategory ?? null,
    source: input.source,
    userId: input.userId ?? null,
  });
  return { id, verdict };
}

function readModelCategory(fields: unknown): Category | null {
  if (typeof fields !== "object" || fields === null) {
    return null;
  }
  const value = (fields as { model_category?: unknown }).model_category;
  return categories.includes(value as Category) ? (value as Category) : null;
}

export async function listForLabeling(
  db: Db,
  ctx: TenantContext,
  mailboxId: string,
  opts: { limit: number; mail: MailKind }
): Promise<LabelItem[]> {
  const rows = await listUnlabeled(db, ctx, mailboxId, opts);
  const summaries = await listSummaries(
    db,
    ctx,
    rows.map((row) => row.email_id)
  );
  return rows.map((row) => ({
    emailId: row.email_id,
    receivedAt: row.received_at,
    from: row.from_address,
    subject: row.subject,
    category: row.category,
    confidence: row.confidence,
    modelCategory: readModelCategory(row.fields),
    summary: summaries.get(row.email_id) ?? null,
  }));
}
