import { categorySchema, type Category, type FeedbackVerdict } from "@ea/core";

import type { TenantContext } from "../../../platform/db";
import { mailKindFilter, type MailKind, type TestMailRule } from "../../mail";

import { verdictSchema } from "./feedback";
import type { DbOrTrx } from "./shared";

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
// The latest triage result of an e-mail and its subject; undefined for an unknown e-mail or one of another org.
export async function getLabelTarget(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<{ category: Category; subject: string | null } | undefined> {
  const row = await db
    .selectFrom("triage_results")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "triage_results.email_id").onRef("emails.org_id", "=", "triage_results.org_id")
    )
    .select(["triage_results.category", "emails.subject"])
    .where("triage_results.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("triage_results.email_id", "=", emailId)
    .orderBy("triage_results.created_at", "desc")
    .orderBy("triage_results.id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return { category: categorySchema.parse(row.category), subject: row.subject };
}
// The latest result per email with no feedback row, newest mail first.
export async function listUnlabeled(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { limit: number; mail: MailKind; testMail: TestMailRule }
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
        .where(mailKindFilter(opts.mail, opts.testMail))
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
  opts: { mail: MailKind; testMail: TestMailRule }
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
        .where(mailKindFilter(opts.mail, opts.testMail))
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
