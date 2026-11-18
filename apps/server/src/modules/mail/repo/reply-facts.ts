import type { ReplyHeaderFacts } from "@ea/core";

import type { TenantContext } from "../../../platform/db";

import { listUserAnswers } from "./sent-readers";
import type { DbOrTrx } from "./shared";

const FACTS_CHUNK = 500;

// What the stored mail says about one incoming mail, for the reply rules (F115 stage 06). Text from the mail (`fromAddress`,
// addresses, `replyTo`) is data for the rules and for the recipient lists of later stages; it never goes to a log line.
export interface MailReplyFacts {
  emailId: string;
  mailboxId: string;
  /** The captured headers; null when the mail has no `email_headers` row. */
  headers: ReplyHeaderFacts | null;
  /** `email_headers.reply_to`; `[]` with no row. */
  replyTo: string[];
  /** `email_flags.answered`, or a user reply in Sent. No flags row and no user reply: false (the pass before a send asks again). */
  answered: boolean;
  /** The addresses of every mailbox of the organization, lower case. The same array for every mail of one call. */
  ownAddresses: string[];
  fromAddress: string | null;
  /** `emails.source_folder` is the junk folder row of the mailbox. */
  fromJunk: boolean;
  /** `emails.folder`: where the mail is now. */
  folder: string;
  /** `emails.moved_at`: set when the assistant moved the mail (a move action), null when it did not. */
  movedAt: Date | null;
  receivedAt: Date;
  threadKey: string;
  toAddresses: string[];
  ccAddresses: string[];
}

// One entry per mail of the organization in `emailIds`; an id of another organization or a missing mail is absent.
// Reads in chunks of 500 ids; no ids, no query. Every query filters `org_id`.
export async function replyFactsOf(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, MailReplyFacts>> {
  const found = new Map<string, MailReplyFacts>();
  if (emailIds.length === 0) return found;

  const ownAddresses = (
    await db.selectFrom("mailboxes").select("address").where("org_id", "=", ctx.orgId).execute()
  ).map((row) => row.address.toLowerCase());
  const junkPaths = new Map(
    (
      await db
        .selectFrom("mailbox_folders")
        .select(["mailbox_id", "path"])
        .where("org_id", "=", ctx.orgId)
        .where("role", "=", "junk")
        .execute()
    ).map((row) => [row.mailbox_id, row.path])
  );

  for (let start = 0; start < emailIds.length; start += FACTS_CHUNK) {
    const chunk = emailIds.slice(start, start + FACTS_CHUNK);
    const mails = await db
      .selectFrom("emails")
      .select([
        "id",
        "mailbox_id",
        "from_address",
        "source_folder",
        "folder",
        "moved_at",
        "received_at",
        "thread_key",
        "to_addresses",
        "cc_addresses",
      ])
      .where("org_id", "=", ctx.orgId)
      .where("id", "in", chunk)
      .execute();
    if (mails.length === 0) continue;
    const ids = mails.map((mail) => mail.id);
    const headerRows = new Map(
      (
        await db
          .selectFrom("email_headers")
          .select([
            "email_id",
            "list_id",
            "list_unsubscribe",
            "auto_submitted",
            "precedence",
            "has_calendar",
            "reply_to",
          ])
          .where("org_id", "=", ctx.orgId)
          .where("email_id", "in", ids)
          .execute()
      ).map((row) => [row.email_id, row])
    );
    const flagged = new Set(
      (
        await db
          .selectFrom("email_flags")
          .select("email_id")
          .where("org_id", "=", ctx.orgId)
          .where("email_id", "in", ids)
          .where("answered", "=", true)
          .execute()
      ).map((row) => row.email_id)
    );
    const userAnswers = await listUserAnswers(db, ctx, ids);
    for (const mail of mails) {
      const header = headerRows.get(mail.id);
      const junkPath = junkPaths.get(mail.mailbox_id);
      found.set(mail.id, {
        emailId: mail.id,
        mailboxId: mail.mailbox_id,
        headers:
          header === undefined
            ? null
            : {
                listId: header.list_id,
                listUnsubscribe: header.list_unsubscribe,
                autoSubmitted: header.auto_submitted,
                precedence: header.precedence,
                hasCalendar: header.has_calendar,
              },
        replyTo: header?.reply_to ?? [],
        answered: flagged.has(mail.id) || userAnswers.has(mail.id),
        ownAddresses,
        fromAddress: mail.from_address,
        fromJunk: junkPath !== undefined && mail.source_folder === junkPath,
        folder: mail.folder,
        movedAt: mail.moved_at,
        receivedAt: mail.received_at,
        threadKey: mail.thread_key,
        toAddresses: mail.to_addresses,
        ccAddresses: mail.cc_addresses,
      });
    }
  }
  return found;
}
