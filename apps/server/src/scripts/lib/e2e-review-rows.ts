import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { E2E_REVIEW_MAIL_COUNT, E2E_REVIEW_SUMMARY, e2eReviewSender, e2eReviewSubject } from "../e2e-seed-args";

import { insertMails, inTransaction } from "./e2e-activity-rows";

const FIRST_UID = 950_001;

// The mail 1 to 12 of the review spec: categories as listed, all received in the last days, none labelled.
const CATEGORIES = [
  "info",
  "notification",
  "spam",
  "needs_reply",
  "info",
  "notification",
  "unsure",
  "info",
  "notification",
  "info",
  "spam",
  "needs_reply",
] as const;

// The rows of the review spec for one organization: a done history check (counts only, so the report page shows its categories and the
// link), and 12 real, triaged, unlabelled mails with a header row (the sender name). Mail 1 has a stored AI summary. The Message-ID is not
// synthetic and the address is not a test sender, so `listReviewSample` counts them. No job of the e2e server reads the mail.
export async function seedReviewRows(db: Db, ctx: TenantContext, mailboxId: string, now: Date): Promise<void> {
  const finishedAt = new Date(now.getTime() - HOUR_MS);
  const entry = { acted: 60, total: 200, wouldMove: 40, outcome: "pass", moved: 0, upper: 0.0602 };
  await inTransaction(db, async (trx) => {
    await trx
      .insertInto("history_checks")
      .values({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        reason: "connect",
        status: "done",
        result: JSON.stringify({ info: entry, notification: entry, spam: entry }),
        created_at: new Date(finishedAt.getTime() - HOUR_MS),
        finished_at: finishedAt,
      })
      .execute();
    const mails = Array.from({ length: E2E_REVIEW_MAIL_COUNT }, (_, index) => ({
      uid: FIRST_UID + index,
      receivedAt: new Date(now.getTime() - (index + 1) * 3 * HOUR_MS),
      subject: e2eReviewSubject(index + 1),
      from: `e2e-review-sender-${index + 1}@review.example`,
      category: CATEGORIES[index % CATEGORIES.length] ?? "info",
      confidence: 0.9,
      reasonCode: "llm",
      reason: "A made-up reason.",
    }));
    const ids = await insertMails(trx, ctx, mailboxId, mails);
    for (const [index, emailId] of ids.entries()) {
      // `insertMails` writes a synthetic Message-ID (`@ea-seed.test`): real mail needs another one.
      await trx
        .updateTable("emails")
        .set({ message_id_header: `<e2e-review-${index + 1}-${randomUUID()}@mail.e2e.test>` })
        .where("id", "=", emailId)
        .where("org_id", "=", ctx.orgId)
        .execute();
      await trx
        .insertInto("email_headers")
        .values({
          email_id: emailId,
          org_id: ctx.orgId,
          from_name: e2eReviewSender(index + 1),
          parts_known: true,
          captured_at: mails[index]?.receivedAt ?? now,
        })
        .execute();
    }
    // `insertAction` has no `save_summary` type, so the one row is written here (as `listSummaries` reads it).
    if (ids[0] !== undefined) {
      await trx
        .insertInto("actions")
        .values({
          org_id: ctx.orgId,
          email_id: ids[0],
          type: "save_summary",
          status: "applied",
          applied_at: now,
          payload: JSON.stringify({ summary: E2E_REVIEW_SUMMARY }),
          idempotency_key: `e2e:${randomUUID()}`,
        })
        .execute();
    }
  });
}
