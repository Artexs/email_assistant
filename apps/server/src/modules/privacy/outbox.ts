import { noticeKinds, type NoticeKind } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../platform/db";

import type { EraseStep } from "./erase";

// What a stored notice (an `outbox` row) holds about mail, by kind. The erase of one person's data (F106 stage 09) needs
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
  approval: "one_mail", // one queue path, `emailId` set
  send_result: "one_mail", // one queue path, `emailId` set
  delegation_answered: "one_mail", // one queue path, `emailId` set
  auth_error: "no_mail", // mailbox address
  sync_stale: "no_mail", // mailbox address, times
  sync_ok: "no_mail", // mailbox address, times
  mailbox_removed: "no_mail", // empty view
  send_held: "no_mail", // mailbox address, limit, counts
  host_blocked: "no_mail", // mailbox address
  weekly_report: "no_mail", // counts and category names only (`renderWeeklyReport`)
};

const MANY_MAILS_KINDS = noticeKinds.filter((kind) => NOTICE_MAIL_CONTENT[kind] === "many_mails");

// What replaces the text of a blanked row (the `delete_mailbox` marker).
const REMOVED = "[removed]";

// A stored message that lists many mails loses its content when a mail goes, since the earliest erased mail. The rows:
//   `sent` or `failed` of a many-mails kind → text `[removed]`, view `{}` (counted `outbox_blanked`); a row that is
//     blanked already is not counted again.
//   `pending` or `sending` digests → deleted (`outbox_dropped`; the next slot covers the period, as `delete_mailbox`).
//   `pending` or `sending` rows of another kind stay: the open-action refusal of the erase means that no waiting
//     approval request names a mail that goes.
// A message that Telegram has delivered stays in the chat: nothing here can recall it (runbook, stage 10).
// Runs in the erase transaction; the `org_id` filter is backed by the row-level policy of the tenant scope.
export const eraseManyMailOutbox: EraseStep = async (trx, orgId, erased) => {
  if (erased.mailIds.length === 0 || erased.earliestCreatedAt === null || MANY_MAILS_KINDS.length === 0) {
    return { outbox_blanked: 0, outbox_dropped: 0 };
  }
  return {
    ...(await blank(trx, orgId, erased.earliestCreatedAt)),
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

async function drop(trx: Transaction<DB>, orgId: string, since: Date): Promise<{ outbox_dropped: number }> {
  const result = await sql`
    delete from outbox
    where org_id = ${orgId}::uuid and kind = 'digest' and status in ('pending', 'sending') and created_at >= ${since}`.execute(
    trx
  );
  return { outbox_dropped: Number(result.numAffectedRows ?? 0n) };
}
