import { categorySchema, type Category } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";
import { senderWindow, type SenderWindowOptions } from "../../mail";

import type { DbOrTrx } from "./shared";

// Readers of the sender activity pass (`contacts`) over the triage tables. Each embeds the incoming mail window of the mail
// module as the CTE `win`, reads only the rows of mails in it, and filters `org_id` (the window scopes the organization and the
// mailbox already). Addresses come back in the rule form and stay in memory: no reader logs an address or a count with one.

export interface NewestResultCount {
  address: string;
  category: Category;
  // Window mails whose newest triage result has this category.
  mails: number;
  // How many of them carry suspicious reasons.
  suspicious: number;
}

// The newest triage result of each mail of the window (newest `created_at`, then the higher `id`), counted per sender address
// and category. A mail without a result has no row. One `DISTINCT ON` pass over the mailbox (a hash join with the window), not
// one index probe per mail: the plan does not depend on the table statistics.
export async function newestResultsBySender(
  db: DbOrTrx,
  ctx: TenantContext,
  window: SenderWindowOptions
): Promise<NewestResultCount[]> {
  const rows = await db
    .with("win", () => senderWindow(db, ctx, window))
    .with("nt", (qb) =>
      qb
        .selectFrom("triage_results as tr")
        .innerJoin("win", "win.id", "tr.email_id")
        .distinctOn("tr.email_id")
        .select(["tr.email_id", "tr.category", sql<boolean>`cardinality(tr.suspicious_reasons) > 0`.as("suspicious")])
        .where("tr.org_id", "=", ctx.orgId)
        .orderBy("tr.email_id")
        .orderBy("tr.created_at", "desc")
        .orderBy("tr.id", "desc")
    )
    .selectFrom("win as w")
    .innerJoin("nt", "nt.email_id", "w.id")
    .select((eb) => [
      "w.address",
      "nt.category",
      eb.fn.countAll<number>().as("mails"),
      eb.fn.countAll<number>().filterWhere("nt.suspicious", "=", true).as("suspicious"),
    ])
    .groupBy(["w.address", "nt.category"])
    .execute();
  return rows.map((row) => ({
    address: row.address,
    category: categorySchema.parse(row.category),
    mails: Number(row.mails),
    suspicious: Number(row.suspicious),
  }));
}

export interface NewestFeedbackCount {
  address: string;
  kind: "correction" | "moved_back" | "rescued";
  // The true category of a `correction`; null for the other kinds.
  category: Category | null;
  mails: number;
}

// The newest feedback row of each mail of the window, counted in three kinds per sender address (a later mark replaces an
// earlier one, so a mail counts once per kind):
// - `correction`: verdict `wrong` with a true category, grouped by that category;
// - `moved_back`: the user moved the mail in the mailbox (`source = imap_move`);
// - `rescued`: the newest triage result is `spam` or `notification`, and the user moved the mail back or corrected it to
//   another category.
export async function newestFeedbackBySender(
  db: DbOrTrx,
  ctx: TenantContext,
  window: SenderWindowOptions
): Promise<NewestFeedbackCount[]> {
  const rows = await db
    .with("win", () => senderWindow(db, ctx, window))
    .with("nt", (qb) =>
      qb
        .selectFrom("triage_results as tr")
        .innerJoin("win", "win.id", "tr.email_id")
        .distinctOn("tr.email_id")
        .select(["tr.email_id", "tr.category"])
        .where("tr.org_id", "=", ctx.orgId)
        .orderBy("tr.email_id")
        .orderBy("tr.created_at", "desc")
        .orderBy("tr.id", "desc")
    )
    .with("nf", (qb) =>
      qb
        .selectFrom("triage_feedback as tf")
        .innerJoin("win", "win.id", "tf.email_id")
        .distinctOn("tf.email_id")
        .select(["tf.email_id", "tf.verdict", "tf.true_category", "tf.source"])
        .where("tf.org_id", "=", ctx.orgId)
        .orderBy("tf.email_id")
        .orderBy("tf.created_at", "desc")
        .orderBy("tf.id", "desc")
    )
    .with("fb", (qb) =>
      qb
        .selectFrom("win as w")
        .innerJoin("nf", "nf.email_id", "w.id")
        .leftJoin("nt", "nt.email_id", "w.id")
        .select(["w.address", "nf.verdict", "nf.true_category", "nf.source", "nt.category"])
    )
    .selectFrom("fb")
    .select((eb) => [
      "fb.address",
      sql<NewestFeedbackCount["kind"]>`'correction'`.as("kind"),
      "fb.true_category as category",
      eb.fn.countAll<number>().as("mails"),
    ])
    .where("fb.verdict", "=", "wrong")
    .where("fb.true_category", "is not", null)
    .groupBy(["fb.address", "fb.true_category"])
    .unionAll((qb) =>
      qb
        .selectFrom("fb")
        .select((eb) => [
          "fb.address",
          sql<NewestFeedbackCount["kind"]>`'moved_back'`.as("kind"),
          sql<string | null>`NULL`.as("category"),
          eb.fn.countAll<number>().as("mails"),
        ])
        .where("fb.source", "=", "imap_move")
        .groupBy("fb.address")
    )
    .unionAll((qb) =>
      qb
        .selectFrom("fb")
        .select((eb) => [
          "fb.address",
          sql<NewestFeedbackCount["kind"]>`'rescued'`.as("kind"),
          sql<string | null>`NULL`.as("category"),
          eb.fn.countAll<number>().as("mails"),
        ])
        .where("fb.category", "in", ["spam", "notification"])
        .where((eb) =>
          eb.or([
            eb("fb.source", "=", "imap_move"),
            eb.and([
              eb("fb.verdict", "=", "wrong"),
              eb("fb.true_category", "is not", null),
              eb("fb.true_category", "not in", ["spam", "notification"]),
            ]),
          ])
        )
        .groupBy("fb.address")
    )
    .execute();
  return rows.map((row) => ({
    address: row.address,
    kind: row.kind,
    category: row.category === null ? null : categorySchema.parse(row.category),
    mails: Number(row.mails),
  }));
}
