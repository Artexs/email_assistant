import { noticeKinds, type NoticeKind } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../platform/db";
import { closeWaitingApprovalSetsSince, releaseMarksOfUndeliveredDigests, SENDER_STALE_MS } from "../channels";

import type { EraseStep } from "./erase";

// What a stored notice (an `outbox` row) holds about mail, by kind. The erase of one person's data needs
// this because a row of a `many_mails` kind has no mail id: the digest view is `{ text, buttons }` with the sender cut to
// 40 characters, so the address pattern of the erase misses it.
//   one_mail  every queue path sets `emailId`: the row goes with its mail (foreign key cascade).
//   many_mails the text or view can name a mail, and no mail id links it: the erase blanks it by time.
//   no_mail   the view names no mail (a mailbox address, a count): the erase leaves it.
// Read at `HEAD` from `channels/notices/*` (queue paths) and `packages/core/src/notices/renderers.ts` (views). A new
// notice kind fails `bun run typecheck` here until it has a class.
export type NoticeMailContent = "one_mail" | "many_mails" | "no_mail";

export const NOTICE_MAIL_CONTENT: Readonly<Record<NoticeKind, NoticeMailContent>> = {
  digest: "many_mails", // rendered list of mails
  approval_set: "many_mails", // `emailId` of its first mail only; lists the subjects of several
  urgent: "one_mail", // one queue path, `emailId` set
  action_failed: "one_mail", // one queue path, `emailId` set
  approval: "one_mail", // `emailId` set; a follow-up card sets `loopId` instead and goes with its loop (foreign key cascade)
  send_result: "one_mail", // one queue path, `emailId` set
  delegation_answered: "one_mail", // one queue path, `emailId` set
  auth_error: "no_mail", // mailbox address
  sync_stale: "no_mail", // mailbox address, times
  sync_ok: "no_mail", // mailbox address, times
  mailbox_removed: "no_mail", // empty view
  send_held: "no_mail", // mailbox address, limit, counts
  host_blocked: "no_mail", // mailbox address
  sent_missing: "no_mail", // mailbox address
  loop_consent: "no_mail", // a fixed line and the panel link: no recipient, no text
  replies_ready: "no_mail", // a count and a clock (`renderRepliesReadyNotice`)
  reply_prompt: "one_mail", // `emailId` set; the view holds the id only
  reply_result: "one_mail", // `emailId` set; the view holds the id and a code
  weekly_report: "no_mail", // counts and category names only (`renderWeeklyReport`)
  approval_edit: "one_mail", // `queueCardEdits` sets `emailId` of the target card; its view keeps the card text
  trust_report_ready: "no_mail", // category names and a count (`renderTrustReportReadyNotice`)
  autonomy_paused: "no_mail", // a category, a fixed reason and a count (`renderAutonomyPausedNotice`)
  not_triaged: "one_mail", // the detector sets `emailId`; the view holds the sender address of that mail
};

const MANY_MAILS_KINDS = noticeKinds.filter((kind) => NOTICE_MAIL_CONTENT[kind] === "many_mails");

// What replaces the text of a blanked row (the `delete_mailbox` marker).
const REMOVED = "[removed]";

// A stored message that lists many mails loses its content when a mail goes, since the earliest erased mail. The rows:
//   `sent` or `failed` of a many-mails kind → text `[removed]`, view `{}` (counted `outbox_blanked`); a row that is
//     blanked already is not counted again.
//   `pending` or `sending` digests → deleted (`outbox_dropped`; the next slot covers the period, as `delete_mailbox`).
//   `pending` or `sending` (stale) approval sets whose sends all closed → `failed` / `outdated`, blanked as above (also
//     counted `outbox_blanked`); a fresh `sending` row is in flight and finishes.
//   `pending` approval sets with a send that still waits stay: the open-action refusal of the erase means that no such
//     request names a mail that goes.
// A message that Telegram has delivered stays in the chat: nothing here can recall it (runbook).
// Runs in the erase transaction; the `org_id` filter is backed by the row-level policy of the tenant scope.
export const eraseManyMailOutbox: EraseStep = async (trx, orgId, erased) => {
  if (erased.mailIds.length === 0 || erased.earliestCreatedAt === null || MANY_MAILS_KINDS.length === 0) {
    return { outbox_blanked: 0, outbox_dropped: 0 };
  }
  const blanked = await blank(trx, orgId, erased.earliestCreatedAt);
  const closed = await closeWaitingSets(trx, orgId, erased.earliestCreatedAt);
  return {
    outbox_blanked: blanked.outbox_blanked + closed,
    ...(await drop(trx, orgId, erased.earliestCreatedAt)),
  };
};

async function blank(trx: Transaction<DB>, orgId: string, since: Date): Promise<{ outbox_blanked: number }> {
  const result = await sql`
    update outbox set text = ${REMOVED}, view = '{}'::jsonb
    where org_id = ${orgId}::uuid
      and kind = any (${MANY_MAILS_KINDS}::text[])
      and status in ('sent', 'failed')
      and created_at >= ${since}
      and (text is distinct from ${REMOVED} or view <> '{}'::jsonb)`.execute(trx);
  return { outbox_blanked: Number(result.numAffectedRows ?? 0n) };
}

// A waiting approval set with no send that waits for an answer (the sender holds it for quiet hours or lag): it can list
// the erased mail from item 2 on, and the sender would render it later. It ends as the resume hook ends it, and is
// counted as blanked. A set of a send that still waits stays (the erase refuses while that send names the mail).
async function closeWaitingSets(trx: Transaction<DB>, orgId: string, since: Date): Promise<number> {
  return closeWaitingApprovalSetsSince(
    trx,
    { orgId },
    { since, staleBefore: new Date(Date.now() - SENDER_STALE_MS), text: REMOVED }
  );
}

async function drop(trx: Transaction<DB>, orgId: string, since: Date): Promise<{ outbox_dropped: number }> {
  // The pending digests go undelivered: the marks of the loops that they name go back first.
  await releaseMarksOfUndeliveredDigests(trx, { orgId }, { since });
  const result = await sql`
    delete from outbox
    where org_id = ${orgId}::uuid and kind = 'digest' and status in ('pending', 'sending') and created_at >= ${since}`.execute(
    trx
  );
  return { outbox_dropped: Number(result.numAffectedRows ?? 0n) };
}

// A loop that an erase cleared (its ask and subject) may be named in the brief lines of stored digests: `view.loopIds` holds
// the ids of the loops that a digest named. Such a digest loses its text and view, whatever else it listed: the
// address scrub of the erase would leave the ask and the subject in the line. A `sent` or `failed` row is blanked as `blank` does;
// a `pending` or `sending` digest is deleted (the next slot covers the period, as `drop` does). A delivered message stays in the
// chat: nothing here can recall it. Returns the rows blanked and the rows deleted.
export async function blankDigestsNamingLoops(
  trx: Transaction<DB>,
  orgId: string,
  loopIds: readonly string[]
): Promise<{ blanked: number; dropped: number }> {
  if (loopIds.length === 0) return { blanked: 0, dropped: 0 };
  const names = sql`jsonb_typeof(view->'loopIds') = 'array' and exists (
    select 1 from unnest(${[...loopIds]}::text[]) as l(id) where jsonb_exists(view->'loopIds', l.id))`;
  const blanked = await sql`
    update outbox set text = ${REMOVED}, view = '{}'::jsonb
    where org_id = ${orgId}::uuid and kind = 'digest' and status in ('sent', 'failed') and ${names}`.execute(trx);
  // The pending digests that name a cleared loop are deleted: the marks of their other loops go back first.
  await releaseMarksOfUndeliveredDigests(trx, { orgId }, { named: loopIds, except: loopIds });
  const dropped = await sql`
    delete from outbox
    where org_id = ${orgId}::uuid and kind = 'digest' and status in ('pending', 'sending') and ${names}`.execute(trx);
  return { blanked: Number(blanked.numAffectedRows ?? 0n), dropped: Number(dropped.numAffectedRows ?? 0n) };
}
