import type { Insertable, Selectable, Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import type { MailCapabilities } from "./port";
import type { KnownCopy } from "./sync-rules";

type DbOrTrx = Db | Transaction<DB>;

export interface Cursor {
  uidValidity: number | null;
  lastUid: number | null;
}

export type MailboxRow = Omit<
  Selectable<DB["mailboxes"]>,
  "uidvalidity" | "last_uid" | "capabilities" | "folder_map"
> & {
  uidvalidity: number | null;
  last_uid: number | null;
  capabilities: MailCapabilities | Record<string, never>;
  folder_map: Record<string, string>;
};

export type NewEmail = Omit<Insertable<DB["emails"]>, "id" | "org_id" | "status" | "attempts" | "created_at">;

// Int8 columns compare as strings in Kysely `where`.
function toInt8(value: number | null): string | null {
  return value === null ? null : String(value);
}

function toMailboxRow(row: Selectable<DB["mailboxes"]>): MailboxRow {
  return {
    ...row,
    uidvalidity: row.uidvalidity === null ? null : Number(row.uidvalidity),
    last_uid: row.last_uid === null ? null : Number(row.last_uid),
    capabilities: row.capabilities as MailCapabilities | Record<string, never>,
    folder_map: row.folder_map as Record<string, string>,
  };
}

export async function insertMailbox(
  db: DbOrTrx,
  ctx: TenantContext,
  input: {
    id: string;
    address: string;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    capabilities: MailCapabilities;
    folderMap: Record<string, string>;
  }
): Promise<void> {
  await db
    .insertInto("mailboxes")
    .values({
      id: input.id,
      org_id: ctx.orgId,
      address: input.address,
      imap_host: input.imapHost,
      imap_port: input.imapPort,
      smtp_host: input.smtpHost,
      smtp_port: input.smtpPort,
      capabilities: JSON.stringify(input.capabilities),
      folder_map: JSON.stringify(input.folderMap),
    })
    .execute();
}

export async function getMailbox(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<MailboxRow | undefined> {
  const row = await db
    .selectFrom("mailboxes")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .executeTakeFirst();
  return row && toMailboxRow(row);
}

export async function lockMailbox(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string
): Promise<MailboxRow | undefined> {
  const row = await trx
    .selectFrom("mailboxes")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .forUpdate()
    .executeTakeFirst();
  return row && toMailboxRow(row);
}

// Conditional update: it changes the cursor only when the stored cursor is still `expected`.
export async function updateCursor(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  expected: Cursor,
  next: Cursor
): Promise<boolean> {
  const result = await db
    .updateTable("mailboxes")
    .set({ uidvalidity: next.uidValidity, last_uid: next.lastUid })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .where("uidvalidity", "is not distinct from", toInt8(expected.uidValidity))
    .where("last_uid", "is not distinct from", toInt8(expected.lastUid))
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export async function markSynced(db: DbOrTrx, ctx: TenantContext, mailboxId: string, at: Date): Promise<void> {
  await db
    .updateTable("mailboxes")
    .set({ last_synced_at: at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .execute();
}

export async function setMailboxStatus(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  status: "active" | "auth_error" | "paused"
): Promise<void> {
  await db
    .updateTable("mailboxes")
    .set({ status })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .execute();
}

export async function insertCredentials(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { mailboxId: string; encryptedSecret: string; secretKind: "password" | "app_password"; keyVersion: number }
): Promise<void> {
  await db
    .insertInto("mailbox_credentials")
    .values({
      mailbox_id: input.mailboxId,
      org_id: ctx.orgId,
      encrypted_secret: input.encryptedSecret,
      secret_kind: input.secretKind,
      key_version: input.keyVersion,
    })
    .execute();
}

export async function getCredentials(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<{ encrypted_secret: string; secret_kind: string; key_version: number } | undefined> {
  return db
    .selectFrom("mailbox_credentials")
    .select(["encrypted_secret", "secret_kind", "key_version"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
}

export async function findCopies(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  key: { messageId: string | null; contentHash: string }
): Promise<KnownCopy[]> {
  const rows = await db
    .selectFrom("emails")
    .select(["id", "dedup_key", "folder"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("message_id_header", key.messageId === null ? "is" : "=", key.messageId)
    .where("content_hash", "=", key.contentHash)
    .execute();
  return rows.map((row) => ({ id: row.id, dedupKey: row.dedup_key, folder: row.folder }));
}

export async function insertEmail(db: DbOrTrx, ctx: TenantContext, row: NewEmail): Promise<boolean> {
  const result = await db
    .insertInto("emails")
    .values({ ...row, org_id: ctx.orgId })
    .onConflict((oc) => oc.columns(["mailbox_id", "dedup_key"]).doNothing())
    .executeTakeFirst();
  return (result.numInsertedOrUpdatedRows ?? 0n) > 0n;
}

export async function updateEmailUid(db: DbOrTrx, ctx: TenantContext, emailId: string, uid: number): Promise<void> {
  await db.updateTable("emails").set({ uid }).where("org_id", "=", ctx.orgId).where("id", "=", emailId).execute();
}

export async function markEmailReturned(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  uid: number,
  at: Date
): Promise<void> {
  await db
    .updateTable("emails")
    .set({ returned_at: at, folder: "INBOX", uid })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .execute();
}

// Scheduler entry point: lists work across tenants, so it takes no TenantContext. Callers build a TenantContext from orgId for every later call.
export async function listSyncTargets(db: DbOrTrx): Promise<{ orgId: string; mailboxId: string }[]> {
  const rows = await db
    .selectFrom("mailboxes")
    .select(["org_id", "id"])
    .where("status", "=", "active")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ orgId: row.org_id, mailboxId: row.id }));
}
