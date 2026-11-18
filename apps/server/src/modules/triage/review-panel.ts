import type { PanelReviewLabelBody, PanelReviewLabelResult, PanelReviewSample } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { listDelegates } from "../delegation";
import { getMailbox, listMailExamples, type TestMailRule } from "../mail";

import { recordFeedback, listForReview } from "./feedback";
import { getLabelTarget } from "./repo";

// The panel review "Check 10 decisions" (flag `panel_review`; the caller checks the flag). The same sample rules as the
// Telegram `/review` page (`listReviewSample`): real mail of the last 30 days, no feedback row, random order. The seed (user id and the
// time of the request) gives a new sample on each load. Every query filters `org_id`. Mail text (sender name, subject, the stored AI
// summary) goes only into the answer: this file logs nothing.

/** `null`: the mailbox is not one of this organization (the same answer as for an unknown id). */
export async function reviewSampleFor(
  db: Db,
  ctx: TenantContext,
  input: { mailboxId: string; userId: string; now: Date; testMail: TestMailRule }
): Promise<PanelReviewSample | null> {
  if ((await getMailbox(db, ctx, input.mailboxId)) === undefined) return null;
  const items = await listForReview(db, ctx, {
    mailboxIds: [input.mailboxId],
    now: input.now,
    seed: `${input.userId}:${input.now.toISOString()}`,
    testMail: input.testMail,
  });
  // The sender's display name only (no address): the same read as the trust examples.
  const facts = await listMailExamples(
    db,
    ctx,
    items.map((item) => item.emailId)
  );
  return {
    items: items.map((item) => ({
      emailId: item.emailId,
      receivedAt: item.receivedAt.toISOString(),
      fromName: facts.get(item.emailId)?.fromName ?? null,
      subject: item.subject,
      category: item.category,
      confidence: item.confidence,
      aiText: item.summary,
    })),
    delegation: await hasActiveDelegate(db, ctx),
  };
}

async function hasActiveDelegate(db: Db | Transaction<DB>, ctx: TenantContext): Promise<boolean> {
  return (await listDelegates(db, ctx, { activeOnly: true, limit: 1 })).length > 0;
}

export type ReviewLabelOutcome =
  | { kind: "not_found" }
  // `right` on a mail the assistant could not place (`unsure`): the user must name a category.
  | { kind: "needs_category" }
  // `delegation` named while the organization has no active delegate.
  | { kind: "no_delegates" }
  | { kind: "saved"; result: PanelReviewLabelResult };

// One label with the source `review`. A mail of another organization and an unknown id are both `not_found`. The same answer twice
// writes nothing (`saved: false`). The row feeds the tripwire and the real-label block only: nothing here turns a category on.
export async function labelReviewItem(
  db: Db,
  ctx: TenantContext,
  input: { body: PanelReviewLabelBody; userId: string }
): Promise<ReviewLabelOutcome> {
  return db.transaction().execute(async (trx): Promise<ReviewLabelOutcome> => {
    const target = await getLabelTarget(trx, ctx, input.body.emailId);
    if (target === undefined) return { kind: "not_found" };
    const trueCategory = "category" in input.body ? input.body.category : target.category;
    if (trueCategory === "unsure") return { kind: "needs_category" };
    if (trueCategory === "delegation" && target.category !== "delegation" && !(await hasActiveDelegate(trx, ctx))) {
      return { kind: "no_delegates" };
    }
    const saved = await recordFeedback(trx, ctx, {
      emailId: input.body.emailId,
      trueCategory,
      source: "review",
      userId: input.userId,
      skipIfSame: true,
    });
    return { kind: "saved", result: { saved: saved.saved, verdict: saved.verdict, aiCategory: target.category } };
  });
}
