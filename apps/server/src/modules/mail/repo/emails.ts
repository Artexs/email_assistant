import { expressionBuilder, sql, type Expression, type Insertable, type SqlBool } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";
import { SYNTHETIC_MESSAGE_ID_LIKE, type TestMailRule } from "../seed";

import { mailboxStatusSchema, type MailboxStatus } from "./mailboxes";
import type { DbOrTrx } from "./shared";

export type MailKind = "real" | "synthetic";
// Test mail = a synthetic Message-ID (`emails.message_id_header`) or a sender in the rule (`lower(emails.from_address)`); real mail is every other row (NULL columns count as not test).
// An empty sender list adds no `IN ()` clause: Postgres refuses an empty IN list.
export function mailKindFilter(kind: MailKind, rule: TestMailRule): Expression<SqlBool> {
  const eb = expressionBuilder<DB, "emails">();
  const fromSender = sql<boolean>`lower(emails.from_address) in (${sql.join(rule.senders)})`;
  if (kind === "synthetic") {
    const synthetic = eb("emails.message_id_header", "ilike", SYNTHETIC_MESSAGE_ID_LIKE);
    return rule.senders.length === 0 ? synthetic : eb.or([synthetic, fromSender]);
  }
  const notSynthetic = eb.or([
    eb("emails.message_id_header", "is", null),
    eb("emails.message_id_header", "not ilike", SYNTHETIC_MESSAGE_ID_LIKE),
  ]);
  if (rule.senders.length === 0) return notSynthetic;
  return eb.and([notSynthetic, eb.or([eb("emails.from_address", "is", null), eb.not(fromSender)])]);
}
// `source_folder` has a DB default (INBOX), but no insert path may rely on it (D6).
export type NewEmail = Omit<
  Insertable<DB["emails"]>,
  "id" | "org_id" | "status" | "attempts" | "created_at" | "source_folder"
> & { source_folder: string };
export async function insertEmail(db: DbOrTrx, ctx: TenantContext, row: NewEmail): Promise<boolean> {
  const result = await db
    .insertInto("emails")
    .values({ ...row, inbox_uid: row.uid, org_id: ctx.orgId })
    .onConflict((oc) => oc.columns(["mailbox_id", "dedup_key"]).doNothing())
    .executeTakeFirst();
  return (result.numInsertedOrUpdatedRows ?? 0n) > 0n;
}
// `inbox_uid` (the UID in `source_folder`) changes only when the row sits in its source folder.
// Only while the row is still in `opts.folder`, the folder of the decision: a move in between keeps its UID.
export async function updateEmailUid(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  uid: number,
  opts: { folder: string; isSource?: boolean }
): Promise<boolean> {
  const result = await db
    .updateTable("emails")
    .set(opts.isSource === false ? { uid } : { uid, inbox_uid: uid })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .where("folder", "=", opts.folder)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
// D8 returned: the user put the mail into synced folder `opts.folder`. Only while the row is system-moved.
export async function markEmailReturned(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  uid: number,
  at: Date,
  opts: { folder: string }
): Promise<boolean> {
  const result = await db
    .updateTable("emails")
    .set({ returned_at: at, folder: opts.folder, source_folder: opts.folder, uid, inbox_uid: uid })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .whereRef("folder", "<>", "source_folder")
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
// D8 relocated: the user moved the mail between synced folders. Only while the row is still in the old source folder.
export async function markEmailRelocated(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  change: { from: string; to: string; uid: number }
): Promise<boolean> {
  const result = await db
    .updateTable("emails")
    .set({ folder: change.to, source_folder: change.to, uid: change.uid, inbox_uid: change.uid })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .whereRef("folder", "=", "source_folder")
    .where("folder", "=", change.from)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
// Rows that the sync flagged as returned (D12), oldest flag first.
export async function listReturned(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { limit: number }
): Promise<{ id: string }[]> {
  return db
    .selectFrom("emails")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("returned_at", "is not", null)
    .orderBy("returned_at")
    .orderBy("id")
    .limit(opts.limit)
    .execute();
}
// False when the flag was clear already.
export async function clearReturned(trx: DbOrTrx, ctx: TenantContext, emailId: string): Promise<boolean> {
  const result = await trx
    .updateTable("emails")
    .set({ returned_at: null })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .where("returned_at", "is not", null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
// D22: `at` marks a reverse move in flight (the sync stores no INBOX copy of the mail); `null` clears it.
export async function setUndoPending(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  at: Date | null
): Promise<boolean> {
  const result = await db
    .updateTable("emails")
    .set({ undo_pending_at: at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
// The mailbox facts of one mail for the Undo service. `undefined` = no such mail in this organization.
export async function getEmailMailbox(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<
  | { mailboxId: string; mailboxStatus: MailboxStatus; messageIdHeader: string | null; fromAddress: string | null }
  | undefined
> {
  const row = await db
    .selectFrom("emails")
    .innerJoin("mailboxes", "mailboxes.id", "emails.mailbox_id")
    .select(["emails.mailbox_id", "mailboxes.status", "emails.message_id_header", "emails.from_address"])
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.id", "=", emailId)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  return {
    mailboxId: row.mailbox_id,
    mailboxStatus: mailboxStatusSchema.parse(row.status),
    messageIdHeader: row.message_id_header,
    fromAddress: row.from_address,
  };
}
export interface EmailMeta {
  id: string;
  mailbox_id: string;
  subject: string | null;
  from_address: string | null;
  message_id_header: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  received_at: Date;
}
// Header facts of one mail, for other modules (the reminder thread). `undefined` = no such mail in this organization.
export async function getEmailMeta(db: DbOrTrx, ctx: TenantContext, emailId: string): Promise<EmailMeta | undefined> {
  return db
    .selectFrom("emails")
    .select([
      "id",
      "mailbox_id",
      "subject",
      "from_address",
      "message_id_header",
      "in_reply_to",
      "references_header",
      "received_at",
    ])
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .executeTakeFirst();
}
// `undefined` keeps the column (M7). `sourceUid` writes `inbox_uid` (the UID in `source_folder`). `movedAt: null` clears `moved_at` (the mail is back in its source folder). `undoPendingAt: null` clears the D22 flag. Never touches `status` or `returned_at`.
export async function updateEmailLocation(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  next: { folder: string; uid: number; sourceUid?: number; movedAt?: Date | null; undoPendingAt?: null }
): Promise<boolean> {
  const result = await db
    .updateTable("emails")
    .set({
      folder: next.folder,
      uid: next.uid,
      ...(next.sourceUid === undefined ? {} : { inbox_uid: next.sourceUid }),
      ...(next.movedAt === undefined ? {} : { moved_at: next.movedAt }),
      ...(next.undoPendingAt === undefined ? {} : { undo_pending_at: null }),
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
