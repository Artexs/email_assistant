import { sql } from "kysely";
import { z } from "zod";

import type { TenantContext } from "../../../platform/db";
import type { CapturedAttachment, CapturedHeaders, CapturedLink } from "../port";

import type { DbOrTrx } from "./shared";

const RETENTION_BATCH = 1000;

export interface EmailHeadersRow extends CapturedHeaders {
  emailId: string;
  capturedAt: Date;
  textsClearedAt: Date | null;
}

const attachmentsSchema = z.array(
  z.object({ name: z.string().nullable(), type: z.string(), size: z.number(), inline: z.boolean() })
) satisfies z.ZodType<CapturedAttachment[]>;
const linksSchema = z.array(z.object({ host: z.string(), textHost: z.string().nullable() })) satisfies z.ZodType<
  CapturedLink[]
>;

// One statement: the row of the mail with this dedup key, in this organization and mailbox. No mail or an existing row: false.
export async function insertEmailHeaders(
  trx: DbOrTrx,
  ctx: TenantContext,
  mail: { mailboxId: string; dedupKey: string },
  capture: CapturedHeaders,
  capturedAt: Date
): Promise<boolean> {
  const result = await sql`
    INSERT INTO email_headers (
      email_id, org_id, from_name, reply_to, return_path, auth_results, list_unsubscribe, list_id,
      auto_submitted, precedence, has_calendar, attachments, attachment_count, links, link_count,
      parts_known, captured_at
    )
    SELECT
      e.id, e.org_id, ${capture.fromName}::text, ${capture.replyTo}::text[], ${capture.returnPath}::text,
      ${capture.authResults}::text, ${capture.listUnsubscribe}::text, ${capture.listId}::text,
      ${capture.autoSubmitted}::text, ${capture.precedence}::text, ${capture.hasCalendar}::boolean,
      ${JSON.stringify(capture.attachments)}::jsonb, ${capture.attachmentCount}::integer,
      ${JSON.stringify(capture.links)}::jsonb, ${capture.linkCount}::integer,
      ${capture.partsKnown}::boolean, ${capturedAt}::timestamptz
    FROM emails e
    WHERE e.org_id = ${ctx.orgId} AND e.mailbox_id = ${mail.mailboxId} AND e.dedup_key = ${mail.dedupKey}
    ON CONFLICT (email_id) DO NOTHING
  `.execute(trx);
  return (result.numAffectedRows ?? 0n) > 0n;
}

export async function getEmailHeaders(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<EmailHeadersRow | undefined> {
  const row = await db
    .selectFrom("email_headers")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  return {
    emailId: row.email_id,
    fromName: row.from_name,
    replyTo: row.reply_to,
    returnPath: row.return_path,
    authResults: row.auth_results,
    listUnsubscribe: row.list_unsubscribe,
    listId: row.list_id,
    autoSubmitted: row.auto_submitted,
    precedence: row.precedence,
    hasCalendar: row.has_calendar,
    attachments: attachmentsSchema.parse(row.attachments),
    attachmentCount: row.attachment_count,
    links: linksSchema.parse(row.links),
    linkCount: row.link_count,
    partsKnown: row.parts_known,
    capturedAt: row.captured_at,
    textsClearedAt: row.texts_cleared_at,
  };
}

// Retention: the text fields of rows captured before `before` go, the counts and codes stay.
// Like `clearMailHeaders`: batches by id, rows that a job holds wait for the next day, a repeat call changes nothing.
export async function clearCapturedHeaders(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("email_headers")
      .set({
        from_name: null,
        reply_to: sql`'{}'`,
        return_path: null,
        auth_results: null,
        list_unsubscribe: null,
        list_id: null,
        attachments: sql`'[]'::jsonb`,
        links: sql`'[]'::jsonb`,
        texts_cleared_at: sql`now()`,
      })
      .where("org_id", "=", ctx.orgId)
      .where(
        "email_id",
        "in",
        db
          .selectFrom("email_headers")
          .select("email_id")
          .where("org_id", "=", ctx.orgId)
          .where("texts_cleared_at", "is", null)
          .where("captured_at", "<", opts.before)
          .orderBy("email_id")
          .limit(batch)
          .forUpdate()
          .skipLocked()
      )
      .executeTakeFirstOrThrow();
    const changed = Number(result.numUpdatedRows);
    total += changed;
    if (changed === 0) return total;
  }
}
