// Row reader of the urgent notice time (M5). Every table is joined with its own `org_id` filter; no subject, no text.
import { quietHoursOf, type QuietHours, type UrgentNoticeRow, type WeekQuery } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { mailKindFilter, type TestMailRule } from "../mail";

type DbOrTrx = Db | Transaction<DB>;

const rowSchema = z.object({
  email_id: z.string(),
  received_at: z.date(),
  notice_at: z.date().nullable(),
});

/** Real, non-backfilled mail of the week whose latest triage category is `urgent`, with its first sent urgent notice. */
export async function listUrgentNoticeTimes(db: DbOrTrx, ctx: TenantContext, q: WeekQuery): Promise<UrgentNoticeRow[]> {
  const mailbox = q.mailboxId === null ? sql`true` : sql`emails.mailbox_id = ${q.mailboxId}`;
  const { rows } = await sql<unknown>`
    SELECT emails.id AS email_id, emails.received_at,
      (
        SELECT MIN(o.sent_at) FROM outbox o
        WHERE o.org_id = ${ctx.orgId} AND o.email_id = emails.id AND o.kind = 'urgent' AND o.status = 'sent'
      ) AS notice_at
    FROM emails
    JOIN LATERAL (
      SELECT tr.category
      FROM triage_results tr
      WHERE tr.org_id = ${ctx.orgId} AND tr.email_id = emails.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) t ON true
    WHERE emails.org_id = ${ctx.orgId}
      AND t.category = 'urgent'
      AND emails.backfilled_at IS NULL
      AND emails.received_at >= ${q.range.start} AND emails.received_at < ${q.range.end}
      AND ${mailbox}
      AND ${mailKindFilter("real", q.testMail)}
    ORDER BY emails.received_at, emails.id
  `.execute(db);
  return rows.map((raw) => {
    const row = rowSchema.parse(raw);
    return { emailId: row.email_id, receivedAt: row.received_at, noticeAt: row.notice_at };
  });
}

export interface UrgentCandidate {
  emailId: string;
  orgId: string;
  receivedAt: Date;
  // The latest of the receive time, the last status change of the mailbox and the organization resume: the mail cannot
  // wait for its notice before this time.
  startAt: Date;
  // The first sent `urgent` notice of the mail.
  noticeAt: Date | null;
  timeZone: string;
  // The quiet hours that count for the wait (F110 stage 18, Q18). With a sent notice: the hours of the user of the sent
  // row that gave `noticeAt`. Without one: the hours of the user of each pending or sending urgent row (an empty list:
  // no row yet, so the default applies). A user with no hours of their own gives the default. The caller turns the
  // flag `user_quiet_hours` off per organization by using the default for all.
  quiet: QuietHours[];
}

const quietSchema = z.object({ start: z.string().nullable(), end: z.string().nullable() });

const candidateSchema = z.object({
  email_id: z.string(),
  org_id: z.string(),
  received_at: z.date(),
  start_at: z.date(),
  notice_at: z.date().nullable(),
  time_zone: z.string(),
  notice_quiet: quietSchema.nullable(),
  pending_quiet: z.array(quietSchema),
});

/**
 * F114 SLO job entry point: no TenantContext, it reads every organization that is not `suspended`. Every table is joined with
 * its own `org_id`. It returns ids, times and the zone name only; no address, subject or text.
 * The mail the urgent detector (`notices/urgent.ts`) would notify, received at or after `since`: real, not backfilled, latest
 * triage `urgent`, not in the junk folder of its mailbox, mailbox `active`, the organization has a linked chat, the triage
 * came after the first link and after the organization resume.
 */
export async function listUrgentCandidates(
  db: DbOrTrx,
  opts: { since: Date; testMail: TestMailRule }
): Promise<UrgentCandidate[]> {
  const { rows } = await sql<unknown>`
    SELECT emails.id AS email_id, emails.org_id, emails.received_at,
      GREATEST(emails.received_at, mailboxes.status_changed_at, organizations.resumed_at) AS start_at,
      (
        SELECT MIN(o.sent_at) FROM outbox o
        WHERE o.org_id = emails.org_id AND o.email_id = emails.id AND o.kind = 'urgent' AND o.status = 'sent'
      ) AS notice_at,
      organizations.timezone AS time_zone,
      (
        SELECT jsonb_build_object('start', m.quiet_start, 'end', m.quiet_end)
        FROM outbox o
        LEFT JOIN memberships m ON m.org_id = o.org_id AND m.user_id = o.user_id
        WHERE o.org_id = emails.org_id AND o.email_id = emails.id AND o.kind = 'urgent' AND o.status = 'sent'
        ORDER BY o.sent_at, o.id
        LIMIT 1
      ) AS notice_quiet,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('start', m.quiet_start, 'end', m.quiet_end) ORDER BY o.created_at, o.id)
        FROM outbox o
        LEFT JOIN memberships m ON m.org_id = o.org_id AND m.user_id = o.user_id
        WHERE o.org_id = emails.org_id AND o.email_id = emails.id AND o.kind = 'urgent'
          AND o.status IN ('pending', 'sending')
      ), '[]'::jsonb) AS pending_quiet
    FROM emails
    JOIN mailboxes ON mailboxes.id = emails.mailbox_id AND mailboxes.org_id = emails.org_id
    JOIN organizations ON organizations.id = emails.org_id
    JOIN LATERAL (
      SELECT tr.category, tr.created_at
      FROM triage_results tr
      WHERE tr.org_id = emails.org_id AND tr.email_id = emails.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) t ON true
    JOIN LATERAL (
      SELECT MIN(cl.linked_at) AS first_linked_at FROM chat_links cl WHERE cl.org_id = emails.org_id
    ) c ON true
    WHERE t.category = 'urgent'
      AND mailboxes.status = 'active'
      AND organizations.plan <> 'suspended'
      AND emails.backfilled_at IS NULL
      AND emails.received_at >= ${opts.since}
      -- NULL (no linked chat) is never true: such mail gets no urgent notice.
      AND t.created_at >= c.first_linked_at
      AND (organizations.resumed_at IS NULL OR t.created_at >= organizations.resumed_at)
      AND NOT EXISTS (
        SELECT 1 FROM mailbox_folders f
        WHERE f.org_id = emails.org_id AND f.mailbox_id = emails.mailbox_id AND f.role = 'junk'
          AND f.path = emails.source_folder
      )
      AND ${mailKindFilter("real", opts.testMail)}
    ORDER BY start_at, emails.id
  `.execute(db);
  return rows.map((raw) => {
    const row = candidateSchema.parse(raw);
    return {
      emailId: row.email_id,
      orgId: row.org_id,
      receivedAt: row.received_at,
      startAt: row.start_at,
      noticeAt: row.notice_at,
      timeZone: row.time_zone,
      quiet: (row.notice_at === null ? row.pending_quiet : row.notice_quiet === null ? [] : [row.notice_quiet]).map(
        (hours) => quietHoursOf(hours.start, hours.end)
      ),
    };
  });
}
