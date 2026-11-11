import {
  categories,
  isLabelCategory,
  type Category,
  type FeedbackSource,
  type FeedbackVerdict,
  type LabelCategory,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { listSummaries } from "../actions";

import {
  getLabelTarget,
  insertFeedback,
  latestFeedback,
  latestTriageResult,
  listUnlabeled,
  type MailKind,
} from "./repo";

export interface RecordFeedbackInput {
  emailId: string;
  trueCategory?: Category;
  verdict?: FeedbackVerdict;
  source: FeedbackSource;
  userId?: string;
  // The latest row of the mail already holds this answer: write nothing.
  skipIfSame?: boolean;
  // The mail already has a label with a true category (m14): write nothing, so the label stays the latest row.
  keepLabel?: boolean;
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
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: RecordFeedbackInput
): Promise<{ id: string; verdict: FeedbackVerdict; saved: boolean }> {
  if (input.trueCategory === undefined && input.verdict === undefined) {
    throw new HardError("feedback needs a true category or a verdict");
  }
  const latest = await latestTriageResult(db, ctx, input.emailId);
  if (!latest) {
    throw new HardError("email has no triage result");
  }
  if (input.trueCategory === undefined && latest.category === "unsure") {
    throw new HardError("unsure is not a label: give a true category");
  }
  const verdict: FeedbackVerdict =
    input.trueCategory === undefined
      ? (input.verdict as FeedbackVerdict)
      : input.trueCategory === latest.category
        ? "right"
        : "wrong";
  if (input.keepLabel) {
    const previous = await latestFeedback(db, ctx, input.emailId);
    if (previous && previous.true_category !== null) {
      return { id: previous.id, verdict, saved: false };
    }
  }
  if (input.skipIfSame) {
    const previous = await latestFeedback(db, ctx, input.emailId);
    if (previous && previous.verdict === verdict && previous.true_category === (input.trueCategory ?? null)) {
      return { id: previous.id, verdict, saved: false };
    }
  }
  const id = await insertFeedback(db, ctx, {
    emailId: input.emailId,
    verdict,
    trueCategory: input.trueCategory ?? null,
    source: input.source,
    userId: input.userId ?? null,
  });
  return { id, verdict, saved: true };
}

export type WebFeedbackResult =
  | { kind: "not_found" }
  | { kind: "saved"; saved: boolean; verdict: FeedbackVerdict; aiCategory: Category };

// The web feedback: the 404 rule lives here. A mail with no triage result or of another organization is "not found",
// so recordFeedback never throws for it. One transaction, joined when the caller already holds one.
export async function recordWebFeedback(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { emailId: string; trueCategory: LabelCategory; userId: string }
): Promise<WebFeedbackResult> {
  const run = async (trx: Transaction<DB>): Promise<WebFeedbackResult> => {
    const target = await getLabelTarget(trx, ctx, input.emailId);
    if (!target) {
      return { kind: "not_found" };
    }
    if (!isLabelCategory(input.trueCategory)) {
      throw new HardError("not a label category");
    }
    const result = await recordFeedback(trx, ctx, {
      emailId: input.emailId,
      trueCategory: input.trueCategory,
      source: "web",
      userId: input.userId,
      skipIfSame: true,
    });
    return { kind: "saved", saved: result.saved, verdict: result.verdict, aiCategory: target.category };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
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
