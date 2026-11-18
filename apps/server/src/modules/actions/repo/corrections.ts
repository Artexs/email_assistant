// The reader of the user's corrections of moves (the tripwire). One query per organization; the rows hold ids,
// a category and times only: no subject, no address and no text.
import { categorySchema, movingCategories, type Category, type MovingCategory } from "@ea/core";
import { sql } from "kysely";
import { z } from "zod";

import type { TenantContext } from "../../../platform/db";
import { mailKindFilter, type TestMailRule } from "../../mail";

import type { DbOrTrx } from "./shared";

/** One mail that the user corrected, with its move and the moving category that planned the move. */
export interface MoveCorrection {
  emailId: string;
  mailboxId: string;
  category: MovingCategory;
  /** When the move took effect. */
  appliedAt: Date;
  /** The time of the newest feedback row of the mail. */
  correctedAt: Date;
  /** The newest true category that the user named in a `wrong` row of the mail (an Undo row names none). */
  trueCategory: Category | null;
}

const rowSchema = z.object({
  email_id: z.string(),
  mailbox_id: z.string(),
  category: z.enum(movingCategories),
  applied_at: z.date(),
  corrected_at: z.date(),
  true_category: categorySchema.nullable(),
});

/**
 * The corrections of real mail of one organization since `since`. A correction is a mail whose newest `triage_feedback` row has
 * the verdict `wrong` (any source: several rows of one mail count once, the newest wins, as `listLabeledResults`), that has an
 * original `move` action which took effect (`applied`, or `undone` later; the newest by `applied_at`, then id, when a mail has two), and the category of the newest triage result not newer
 * than that action (the result that planned it: `saveTriage` writes both rows in one transaction). A move of a category that does
 * not move mail is left out. `trueCategory` is the newest category that the user named in a `wrong` row of the mail: an Undo row
 * names none, so a pencil row before it still tells that the user needed the mail.
 */
export async function listMoveCorrections(
  db: DbOrTrx,
  ctx: TenantContext,
  since: Date,
  testMail: TestMailRule
): Promise<MoveCorrection[]> {
  const { rows } = await sql<unknown>`
    WITH latest AS (
      SELECT DISTINCT ON (tf.email_id) tf.email_id, tf.verdict, tf.created_at, (
        SELECT w.true_category FROM triage_feedback w
        WHERE w.org_id = ${ctx.orgId} AND w.email_id = tf.email_id AND w.verdict = 'wrong' AND w.true_category IS NOT NULL
        ORDER BY w.created_at DESC, w.id DESC LIMIT 1
      ) AS true_category
      FROM triage_feedback tf
      WHERE tf.org_id = ${ctx.orgId}
        AND tf.email_id IN (
          SELECT n.email_id FROM triage_feedback n
          WHERE n.org_id = ${ctx.orgId} AND n.verdict = 'wrong' AND n.created_at >= ${since}
        )
      ORDER BY tf.email_id, tf.created_at DESC, tf.id DESC
    )
    SELECT l.email_id, emails.mailbox_id, t.category, a.applied_at, l.created_at AS corrected_at, l.true_category
    FROM latest l
    JOIN emails ON emails.id = l.email_id AND emails.org_id = ${ctx.orgId}
    JOIN LATERAL (
      SELECT x.applied_at, x.created_at FROM actions x
      WHERE x.org_id = ${ctx.orgId} AND x.email_id = l.email_id
        AND x.type = 'move' AND x.reverses_action_id IS NULL AND x.status IN ('applied', 'undone')
      ORDER BY x.applied_at DESC, x.id DESC LIMIT 1
    ) a ON true
    JOIN LATERAL (
      SELECT tr.category FROM triage_results tr
      WHERE tr.org_id = ${ctx.orgId} AND tr.email_id = l.email_id AND tr.created_at <= a.created_at
      ORDER BY tr.created_at DESC, tr.id DESC LIMIT 1
    ) t ON true
    WHERE l.verdict = 'wrong' AND l.created_at >= ${since} AND ${mailKindFilter("real", testMail)}
    ORDER BY l.created_at, l.email_id
  `.execute(db);
  const corrections: MoveCorrection[] = [];
  for (const raw of rows) {
    const row = rowSchema.safeParse(raw);
    // A move of another category (a mail of `urgent` never moves) is not a move of a granted category.
    if (!row.success) continue;
    corrections.push({
      emailId: row.data.email_id,
      mailboxId: row.data.mailbox_id,
      category: row.data.category,
      appliedAt: row.data.applied_at,
      correctedAt: row.data.corrected_at,
      trueCategory: row.data.true_category,
    });
  }
  return corrections;
}
