import { sql, type Transaction } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

export type SentContent = "pending" | "stored" | "headers_only" | "gone";

export interface NewSentEmail {
  mailboxId: string;
  dedupKey: string;
  path: string;
  uidValidity: number;
  uid: number;
  messageId: string | null;
  parentMessageId: string | null;
  referencesIds: string[];
  threadKey: string;
  fromAddress: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  sentAt: Date;
  internalDate: Date;
  origin: "user" | "system";
  actionId: string | null;
  content: "pending" | "headers_only";
}

// One statement. A key that exists moves only its location (the mail was moved inside Sent or the folder was renumbered).
// A key with a tombstone inserts nothing (trigger). Callers pass each key once.
// Returns the count of new rows; a moved row does not count.
export async function insertSentEmails(
  trx: Transaction<DB>,
  ctx: TenantContext,
  rows: NewSentEmail[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const written = await trx
    .insertInto("sent_emails")
    .values(
      rows.map((row) => ({
        org_id: ctx.orgId,
        mailbox_id: row.mailboxId,
        dedup_key: row.dedupKey,
        path: row.path,
        uidvalidity: String(row.uidValidity),
        uid: String(row.uid),
        message_id: row.messageId,
        parent_message_id: row.parentMessageId,
        references_ids: row.referencesIds,
        thread_key: row.threadKey,
        from_address: row.fromAddress,
        to_addresses: row.toAddresses,
        cc_addresses: row.ccAddresses,
        subject: row.subject,
        sent_at: row.sentAt,
        internal_date: row.internalDate,
        origin: row.origin,
        action_id: row.actionId,
        content: row.content,
      }))
    )
    .onConflict((oc) =>
      oc.columns(["mailbox_id", "dedup_key"]).doUpdateSet((eb) => ({
        path: eb.ref("excluded.path"),
        uidvalidity: eb.ref("excluded.uidvalidity"),
        uid: eb.ref("excluded.uid"),
        updated_at: sql`now()`,
      }))
    )
    // `xmax` is 0 on a row that this statement inserted, and not 0 on a row that the conflict clause updated.
    .returning(sql<boolean>`(xmax = 0)`.as("inserted"))
    .execute();
  return written.filter((row) => row.inserted).length;
}

// Rows that wait for their text, in this folder and numbering, oldest first.
export async function listPendingSentTexts(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { path: string; uidValidity: number; since: Date; limit: number }
): Promise<{ id: string; uid: number }[]> {
  const rows = await db
    .selectFrom("sent_emails")
    .select(["id", "uid"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("content", "=", "pending")
    .where("path", "=", opts.path)
    .where("uidvalidity", "=", String(opts.uidValidity))
    .where("internal_date", ">=", opts.since)
    .orderBy("internal_date")
    .orderBy("id")
    .limit(opts.limit)
    .execute();
  return rows.map((row) => ({ id: row.id, uid: Number(row.uid) }));
}

export type SentTextWrite =
  | {
      kind: "stored";
      bodyText: string | null;
      autoSubmitted: string | null;
      precedence: string | null;
      listId: string | null;
      hasCalendar: boolean | null;
    }
  | { kind: "gone" };

// Writes the text of a row only while it is `pending` at the place that was read (path, UID, UIDVALIDITY).
// A row that moved, or one that another write or an erase changed, stays as it is. True when the row changed.
export async function writeSentText(
  db: DbOrTrx,
  ctx: TenantContext,
  id: string,
  read: { path: string; uid: number; uidValidity: number },
  write: SentTextWrite
): Promise<boolean> {
  const values =
    write.kind === "stored"
      ? {
          content: "stored",
          body_text: write.bodyText,
          auto_submitted: write.autoSubmitted,
          precedence: write.precedence,
          list_id: write.listId,
          has_calendar: write.hasCalendar,
        }
      : { content: "gone", body_text: null };
  const result = await db
    .updateTable("sent_emails")
    .set({ ...values, updated_at: sql`now()` })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .where("content", "=", "pending")
    .where("path", "=", read.path)
    .where("uid", "=", String(read.uid))
    .where("uidvalidity", "=", String(read.uidValidity))
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Rows that still wait for their text after the text window: they keep their headers and never get a text.
export async function expireSentTexts(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { before: Date }
): Promise<number> {
  const result = await db
    .updateTable("sent_emails")
    .set({ content: "headers_only", updated_at: sql`now()` })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("content", "=", "pending")
    .where("internal_date", "<", opts.before)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

// All sent mail of the mailbox (the switch goes off).
export async function deleteSentEmails(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string): Promise<number> {
  const result = await trx
    .deleteFrom("sent_emails")
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

const SENT_ID_CHUNK = 500;

// Which of the Message-IDs have a row in the Sent store of the mailbox (any origin, any folder path). The ids come back as stored.
export async function listSentMessageIds(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  messageIds: readonly string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let start = 0; start < messageIds.length; start += SENT_ID_CHUNK) {
    const rows = await db
      .selectFrom("sent_emails")
      .select("message_id")
      .where("org_id", "=", ctx.orgId)
      .where("mailbox_id", "=", mailboxId)
      .where("message_id", "in", messageIds.slice(start, start + SENT_ID_CHUNK))
      .execute();
    for (const row of rows) if (row.message_id !== null) found.add(row.message_id);
  }
  return found;
}
