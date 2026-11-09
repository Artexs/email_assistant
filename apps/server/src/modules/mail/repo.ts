import {
  SYNC_FOLDER_DEFAULTS,
  syncFolderKeys,
  syncFolderRoles,
  type FolderKey,
  type SyncFolderDefault,
  type SyncFolderKey,
  type SyncFolderRole,
} from "@ea/core";
import {
  expressionBuilder,
  sql,
  type Expression,
  type Insertable,
  type Selectable,
  type SqlBool,
  type Transaction,
} from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";

import { INBOX, type MailCapabilities } from "./port";
import { SYNTHETIC_MESSAGE_ID_LIKE } from "./seed";
import { otherCopyUids, type KnownCopy } from "./sync-rules";

type DbOrTrx = Db | Transaction<DB>;

export type MailKind = "real" | "synthetic";

// Filter on `emails.message_id_header`: real mail is every row without a synthetic Message-ID (also NULL).
export function mailKindFilter(kind: MailKind): Expression<SqlBool> {
  const eb = expressionBuilder<DB, "emails">();
  if (kind === "synthetic") return eb("emails.message_id_header", "ilike", SYNTHETIC_MESSAGE_ID_LIKE);
  return eb.or([
    eb("emails.message_id_header", "is", null),
    eb("emails.message_id_header", "not ilike", SYNTHETIC_MESSAGE_ID_LIKE),
  ]);
}

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

export interface ClaimedEmail {
  id: string;
  mailbox_id: string;
  locked_at: Date;
  attempts: number;
  next_attempt_at: Date | null;
  backfilled_at: Date | null;
  received_at: Date;
  from_address: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  body_text: string | null;
  thread_key: string;
  message_id_header: string | null;
  in_reply_to: string | null;
  references_header: string | null;
}

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

const syncFolderKeySchema = z.enum(syncFolderKeys);
const syncFolderRoleSchema = z.enum(syncFolderRoles);

// The one row type of the table.
export interface SyncFolderRow {
  id: string;
  mailbox_id: string;
  key: SyncFolderKey;
  path: string;
  role: SyncFolderRole;
  enabled: boolean;
  uidvalidity: number | null;
  last_uid: number | null;
}

function toSyncFolderRow(row: Selectable<DB["mailbox_folders"]>): SyncFolderRow {
  const key = syncFolderKeySchema.safeParse(row.key);
  const role = syncFolderRoleSchema.safeParse(row.role);
  if (!key.success || !role.success) throw new HardError("mailbox_folders row has an unknown key or role");
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    key: key.data,
    path: row.path,
    role: role.data,
    enabled: row.enabled,
    uidvalidity: row.uidvalidity === null ? null : Number(row.uidvalidity),
    last_uid: row.last_uid === null ? null : Number(row.last_uid),
  };
}

export async function insertInboxFolder(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<void> {
  await db
    .insertInto("mailbox_folders")
    .values({ org_id: ctx.orgId, mailbox_id: mailboxId, key: "inbox", path: INBOX, role: "inbox" })
    .onConflict((oc) => oc.columns(["mailbox_id", "key"]).doNothing())
    .execute();
}

export async function getSyncFolder(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  key: SyncFolderKey
): Promise<SyncFolderRow | undefined> {
  const row = await db
    .selectFrom("mailbox_folders")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("key", "=", key)
    .executeTakeFirst();
  return row && toSyncFolderRow(row);
}

export async function lockSyncFolder(
  trx: Transaction<DB>,
  ctx: TenantContext,
  folderId: string
): Promise<SyncFolderRow | undefined> {
  const row = await trx
    .selectFrom("mailbox_folders")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", folderId)
    .forUpdate()
    .executeTakeFirst();
  return row && toSyncFolderRow(row);
}

// Order: INBOX, then the sort rows in SYNC_FOLDER_DEFAULTS order, then junk.
export async function listSyncFolders(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { enabledOnly: boolean }
): Promise<SyncFolderRow[]> {
  const keyOrder = sql<number>`case key ${sql.join(
    SYNC_FOLDER_DEFAULTS.map((item, index) => sql`when ${sql.lit(item.key)} then ${sql.lit(index)}`),
    sql` `
  )} else ${sql.lit(SYNC_FOLDER_DEFAULTS.length)} end`;
  let query = db
    .selectFrom("mailbox_folders")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId);
  if (opts.enabledOnly) query = query.where("enabled", "=", true);
  const rows = await query
    .orderBy(sql`case role when 'inbox' then 0 when 'sort' then 1 else 2 end`)
    .orderBy(keyOrder)
    .orderBy("key")
    .execute();
  return rows.map(toSyncFolderRow);
}

// One INSERT that never changes an existing row (any unique key). Returns the rows that it inserted.
export async function insertSyncFolders(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  picks: readonly (SyncFolderDefault | { key: "inbox"; path: string; role: "inbox" })[],
  at: Date
): Promise<{ key: SyncFolderKey; role: SyncFolderRole }[]> {
  if (picks.length === 0) return [];
  const rows = await db
    .insertInto("mailbox_folders")
    .values(
      picks.map((pick) => ({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        key: pick.key,
        path: pick.path,
        role: pick.role,
        created_at: at,
        updated_at: at,
      }))
    )
    .onConflict((oc) => oc.doNothing())
    .returning(["key", "role"])
    .execute();
  return rows.map((row) => {
    const key = syncFolderKeySchema.parse(row.key);
    const role = syncFolderRoleSchema.parse(row.role);
    return { key, role };
  });
}

export async function lockSyncFolderByKey(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  key: SyncFolderKey
): Promise<SyncFolderRow | undefined> {
  const row = await trx
    .selectFrom("mailbox_folders")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("key", "=", key)
    .forUpdate()
    .executeTakeFirst();
  return row && toSyncFolderRow(row);
}

// Sets `enabled`; with `clearCursor` the folder starts again with a new first sync.
export async function updateSyncFolderEnabled(
  trx: Transaction<DB>,
  ctx: TenantContext,
  folderId: string,
  change: { enabled: boolean; clearCursor: boolean; at: Date }
): Promise<boolean> {
  const row = await trx
    .updateTable("mailbox_folders")
    .set({
      enabled: change.enabled,
      updated_at: change.at,
      ...(change.clearCursor ? { uidvalidity: null, last_uid: null } : {}),
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", folderId)
    .returning("id")
    .executeTakeFirst();
  return row !== undefined;
}

// The path of the junk row, also when it is disabled.
export async function getJunkFolderPath(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<string | null> {
  const row = await db
    .selectFrom("mailbox_folders")
    .select("path")
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("role", "=", "junk")
    .executeTakeFirst();
  return row?.path ?? null;
}

// Conditional update on the folder row: it changes the cursor only when the stored cursor is still `expected`.
// The INBOX row also writes the two `mailboxes` columns in the same transaction (D3 dual write, for a code rollback).
export async function updateFolderCursor(
  db: DbOrTrx,
  ctx: TenantContext,
  folderId: string,
  expected: Cursor,
  next: Cursor
): Promise<boolean> {
  const run = async (trx: DbOrTrx): Promise<boolean> => {
    const row = await trx
      .updateTable("mailbox_folders")
      .set({ uidvalidity: next.uidValidity, last_uid: next.lastUid, updated_at: sql<Date>`now()` })
      .where("org_id", "=", ctx.orgId)
      .where("id", "=", folderId)
      .where("uidvalidity", "is not distinct from", toInt8(expected.uidValidity))
      .where("last_uid", "is not distinct from", toInt8(expected.lastUid))
      .returning(["mailbox_id", "key"])
      .executeTakeFirst();
    if (row === undefined) return false;
    if (row.key === "inbox") {
      await trx
        .updateTable("mailboxes")
        .set({ uidvalidity: next.uidValidity, last_uid: next.lastUid })
        .where("org_id", "=", ctx.orgId)
        .where("id", "=", row.mailbox_id)
        .execute();
    }
    return true;
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// The CAS of the INBOX row of the mailbox. False when the mailbox has no INBOX row.
export async function updateCursor(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  expected: Cursor,
  next: Cursor
): Promise<boolean> {
  const folder = await getSyncFolder(db, ctx, mailboxId, "inbox");
  if (folder === undefined) return false;
  return updateFolderCursor(db, ctx, folder.id, expected, next);
}

export async function markSynced(db: DbOrTrx, ctx: TenantContext, mailboxId: string, at: Date): Promise<void> {
  await db
    .updateTable("mailboxes")
    .set({ last_synced_at: at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .execute();
}

export type MailboxStatus = "active" | "auth_error" | "paused";

const mailboxStatusSchema = z.enum(["active", "auth_error", "paused"]);

// The update is unconditional (an `auth_error` from the sync job wins over a pause). `status_changed_at` moves only when the status really changes.
export async function setMailboxStatus(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  status: MailboxStatus,
  at?: Date
): Promise<void> {
  await db
    .updateTable("mailboxes")
    .set({
      status,
      status_changed_at: sql<Date>`CASE WHEN status IS DISTINCT FROM ${status} THEN ${at ?? sql`now()`} ELSE status_changed_at END`,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .execute();
}

// Conditional update: it changes the row only while the status is still `change.from`.
export async function changeMailboxStatus(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  change: { from: "active" | "paused"; to: "active" | "paused"; at: Date }
): Promise<boolean> {
  const result = await db
    .updateTable("mailboxes")
    .set({ status: change.to, status_changed_at: change.at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .where("status", "=", change.from)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export interface MailboxSummary {
  id: string;
  address: string;
  status: MailboxStatus;
  last_synced_at: Date | null;
  status_changed_at: Date;
  created_at: Date;
}

export async function listMailboxes(db: DbOrTrx, ctx: TenantContext): Promise<MailboxSummary[]> {
  const rows = await db
    .selectFrom("mailboxes")
    .select(["id", "address", "status", "last_synced_at", "status_changed_at", "created_at"])
    .where("org_id", "=", ctx.orgId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ ...row, status: mailboxStatusSchema.parse(row.status) }));
}

// Mail that waits for triage in all mailboxes of the org.
export async function countWaiting(db: DbOrTrx, ctx: TenantContext, opts: { receivedSince: Date }): Promise<number> {
  const row = await db
    .selectFrom("emails")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("status", "in", ["pending", "processing"])
    .where("received_at", ">=", opts.receivedSince)
    .executeTakeFirstOrThrow();
  return Number(row.count);
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

// Replaces the stored secret of a mailbox. False when the credentials row is missing.
export async function updateCredentials(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  row: { encryptedSecret: string; secretKind: "password" | "app_password"; keyVersion: number }
): Promise<boolean> {
  const result = await db
    .updateTable("mailbox_credentials")
    .set({ encrypted_secret: row.encryptedSecret, secret_kind: row.secretKind, key_version: row.keyVersion })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
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
    .select(["id", "dedup_key", "folder", "uid", "content_hash", "from_address", "received_at", "undo_pending_at"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("message_id_header", key.messageId === null ? "is" : "=", key.messageId)
    .where("content_hash", "=", key.contentHash)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    dedupKey: row.dedup_key,
    folder: row.folder,
    uid: Number(row.uid),
    contentHash: row.content_hash,
    from: row.from_address,
    receivedAt: row.received_at,
    undoPendingAt: row.undo_pending_at,
  }));
}

// The UIDs that the other rows of the same identity hold in `folder` (the `excludeUids` of locateMessage).
export async function listFolderUids(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  folder: string,
  key: { exceptEmailId: string; messageId: string | null; contentHash: string }
): Promise<Set<number>> {
  const copies = await findCopies(db, ctx, mailboxId, key);
  return otherCopyUids(copies, key.exceptEmailId, folder);
}

export interface MovedRow {
  id: string;
  /** The UID in `folder` (the hint of the folder check). */
  uid: number;
  inbox_uid: number | null;
  folder: string;
  message_id_header: string | null;
  content_hash: string;
  from_address: string | null;
  received_at: Date;
  moved_at: Date;
}

// Mail that the system moved out of INBOX lately: the candidates for a return below the UID cursor (D4).
export async function listRecentlyMoved(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { movedAfter: Date; limit: number }
): Promise<MovedRow[]> {
  const rows = await db
    .selectFrom("emails")
    .select([
      "id",
      "uid",
      "inbox_uid",
      "folder",
      "message_id_header",
      "content_hash",
      "from_address",
      "received_at",
      "moved_at",
    ])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("folder", "<>", INBOX)
    .where("inbox_uid", "is not", null)
    .where("moved_at", ">=", opts.movedAfter)
    .orderBy("moved_at", "desc")
    .orderBy("id")
    .limit(opts.limit)
    .execute();
  return rows.flatMap((row) =>
    row.moved_at === null
      ? []
      : [
          {
            ...row,
            uid: Number(row.uid),
            inbox_uid: row.inbox_uid === null ? null : Number(row.inbox_uid),
            moved_at: row.moved_at,
          },
        ]
  );
}

export async function insertEmail(db: DbOrTrx, ctx: TenantContext, row: NewEmail): Promise<boolean> {
  const result = await db
    .insertInto("emails")
    .values({ ...row, inbox_uid: row.uid, org_id: ctx.orgId })
    .onConflict((oc) => oc.columns(["mailbox_id", "dedup_key"]).doNothing())
    .executeTakeFirst();
  return (result.numInsertedOrUpdatedRows ?? 0n) > 0n;
}

export async function updateEmailUid(db: DbOrTrx, ctx: TenantContext, emailId: string, uid: number): Promise<void> {
  await db
    .updateTable("emails")
    .set({ uid, inbox_uid: uid })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .execute();
}

export async function markEmailReturned(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  uid: number,
  at: Date,
  opts: { onlyOutsideInbox?: boolean } = {}
): Promise<boolean> {
  let query = db
    .updateTable("emails")
    .set({ returned_at: at, folder: INBOX, uid, inbox_uid: uid })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId);
  // The below-cursor check must not touch a row that the normal path already moved back.
  if (opts.onlyOutsideInbox === true) query = query.where("folder", "<>", INBOX);
  const result = await query.executeTakeFirst();
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
  | { mailboxId: string; mailboxAddress: string; mailboxStatus: MailboxStatus; messageIdHeader: string | null }
  | undefined
> {
  const row = await db
    .selectFrom("emails")
    .innerJoin("mailboxes", "mailboxes.id", "emails.mailbox_id")
    .select(["emails.mailbox_id", "mailboxes.address", "mailboxes.status", "emails.message_id_header"])
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.id", "=", emailId)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  return {
    mailboxId: row.mailbox_id,
    mailboxAddress: row.address,
    mailboxStatus: mailboxStatusSchema.parse(row.status),
    messageIdHeader: row.message_id_header,
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

// The draft removal needs UIDPLUS (D13). An unknown mailbox counts as no UIDPLUS.
export async function mailboxHasUidplus(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  const mailbox = await getMailbox(db, ctx, mailboxId);
  return (mailbox?.capabilities as Partial<MailCapabilities> | undefined)?.uidplus === true;
}

// `undefined` keeps the column (M7). `movedAt: null` clears `moved_at` (an Undo back to INBOX). `undoPendingAt: null` clears the D22 flag. Never touches `status` or `returned_at`.
export async function updateEmailLocation(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  next: { folder: string; uid: number; inboxUid?: number; movedAt?: Date | null; undoPendingAt?: null }
): Promise<boolean> {
  const result = await db
    .updateTable("emails")
    .set({
      folder: next.folder,
      uid: next.uid,
      ...(next.inboxUid === undefined ? {} : { inbox_uid: next.inboxUid }),
      ...(next.movedAt === undefined ? {} : { moved_at: next.movedAt }),
      ...(next.undoPendingAt === undefined ? {} : { undo_pending_at: null }),
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Replaces one key of `mailboxes.folder_map` and keeps the others.
export async function setFolderMapEntry(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  key: FolderKey | "drafts" | "sent",
  path: string
): Promise<boolean> {
  const result = await db
    .updateTable("mailboxes")
    .set({ folder_map: sql`jsonb_set(folder_map, ARRAY[${key}]::text[], to_jsonb(${path}::text), true)` })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Scheduler entry point: lists work across tenants, so it takes no TenantContext. Callers build a TenantContext from orgId for every later call.
export async function listMailboxTargets(
  db: DbOrTrx,
  opts: { statuses: readonly MailboxStatus[] }
): Promise<{ orgId: string; mailboxId: string }[]> {
  if (opts.statuses.length === 0) return [];
  const rows = await db
    .selectFrom("mailboxes")
    .select(["org_id", "id"])
    .where("status", "in", opts.statuses)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ orgId: row.org_id, mailboxId: row.id }));
}

export function listSyncTargets(db: DbOrTrx): Promise<{ orgId: string; mailboxId: string }[]> {
  return listMailboxTargets(db, { statuses: ["active"] });
}

// Forces the next sync to rescan: a real server never has UIDVALIDITY 0, so the sync sees a change.
export async function forceRescan(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  const run = async (trx: DbOrTrx): Promise<boolean> => {
    const result = await trx
      .updateTable("mailbox_folders")
      .set({ uidvalidity: "0", updated_at: sql<Date>`now()` })
      .where("org_id", "=", ctx.orgId)
      .where("mailbox_id", "=", mailboxId)
      .where("uidvalidity", "is not", null)
      .executeTakeFirst();
    // D3 dual write.
    await trx
      .updateTable("mailboxes")
      .set({ uidvalidity: "0" })
      .where("org_id", "=", ctx.orgId)
      .where("id", "=", mailboxId)
      .where("uidvalidity", "is not", null)
      .execute();
    return result.numUpdatedRows > 0n;
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// Claims due pending rows and stale processing rows. `locked_at` = `opts.now` (a JS value, not SQL now()):
// it is the token for releaseEmail and finishEmail, so it must survive the round trip exactly.
// Taking back a stale processing row counts an attempt (the earlier run may have died on this mail), so `attempts` in
// the result is the new value.
export async function claimEmails(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; staleBefore: Date; syntheticOnly: boolean }
): Promise<ClaimedEmail[]> {
  const rows = await db
    .with("picked", (qb) => {
      let query = qb
        .selectFrom("emails")
        .select("id")
        .where("org_id", "=", ctx.orgId)
        .where("mailbox_id", "=", mailboxId)
        .where((eb) =>
          eb.or([
            eb.and([
              eb("status", "=", "pending"),
              eb.or([eb("next_attempt_at", "is", null), eb("next_attempt_at", "<=", opts.now)]),
            ]),
            eb.and([eb("status", "=", "processing"), eb("locked_at", "<", opts.staleBefore)]),
          ])
        );
      if (opts.syntheticOnly) query = query.where(mailKindFilter("synthetic"));
      return query.orderBy("received_at").orderBy("id").limit(opts.limit).forUpdate().skipLocked();
    })
    .updateTable("emails as e")
    .set((eb) => ({
      status: "processing",
      locked_at: opts.now,
      attempts: eb
        .case()
        .when("e.status", "=", "processing")
        .then(eb("e.attempts", "+", 1))
        .else(eb.ref("e.attempts"))
        .end(),
    }))
    .from("picked")
    .whereRef("e.id", "=", "picked.id")
    .where("e.org_id", "=", ctx.orgId)
    .returning([
      "e.id",
      "e.mailbox_id",
      "e.locked_at",
      "e.attempts",
      "e.next_attempt_at",
      "e.backfilled_at",
      "e.received_at",
      "e.from_address",
      "e.to_addresses",
      "e.cc_addresses",
      "e.subject",
      "e.body_text",
      "e.thread_key",
      "e.message_id_header",
      "e.in_reply_to",
      "e.references_header",
    ])
    .execute();
  // RETURNING has no order.
  return rows
    .map((row) => ({ ...row, locked_at: row.locked_at ?? opts.now }))
    .sort((x, y) => x.received_at.getTime() - y.received_at.getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

// Conditional update: it changes the row only while the claim with `lockedAt` still holds it.
export async function releaseEmail(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  lockedAt: Date,
  opts: { nextAttemptAt: Date | null; countAttempt: boolean }
): Promise<boolean> {
  const result = await db
    .updateTable("emails")
    .set((eb) => ({
      status: "pending",
      locked_at: null,
      next_attempt_at: opts.nextAttemptAt,
      attempts: opts.countAttempt ? eb("attempts", "+", 1) : eb.ref("attempts"),
    }))
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .where("status", "=", "processing")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Conditional update with the same guard as releaseEmail.
export async function finishEmail(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  lockedAt: Date,
  next: { status: "triaged" } | { status: "skipped"; skipReason: "too_old" }
): Promise<boolean> {
  const result = await trx
    .updateTable("emails")
    .set({
      status: next.status,
      skip_reason: next.status === "skipped" ? next.skipReason : null,
      locked_at: null,
      next_attempt_at: null,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .where("status", "=", "processing")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export async function listThreadContext(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  threadKey: string,
  before: Date,
  excludeId: string,
  opts: { syntheticOnly: boolean }
): Promise<{ from_address: string | null; subject: string | null; received_at: Date; body_excerpt: string | null }[]> {
  let query = db
    .selectFrom("emails")
    .select(["from_address", "subject", "received_at", sql<string | null>`left(body_text, 500)`.as("body_excerpt")])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("thread_key", "=", threadKey)
    .where("received_at", "<", before)
    .where("id", "!=", excludeId);
  if (opts.syntheticOnly) query = query.where(mailKindFilter("synthetic"));
  return query.orderBy("received_at", "desc").orderBy("id", "desc").limit(3).execute();
}

export async function listInboxEmailKeys(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<{ message_id_header: string | null; content_hash: string }[]> {
  return db
    .selectFrom("emails")
    .select(["message_id_header", "content_hash"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("folder", "=", "INBOX")
    .where("received_at", ">=", since)
    .execute();
}

const MESSAGE_ID_CHUNK = 500;

interface EmailByMessageIdRow {
  id: string;
  message_id_header: string;
  folder: string;
  status: string;
  in_reply_to: string | null;
}

export async function listEmailsByMessageIds(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  messageIds: readonly string[]
): Promise<EmailByMessageIdRow[]> {
  const rows: EmailByMessageIdRow[] = [];
  for (let start = 0; start < messageIds.length; start += MESSAGE_ID_CHUNK) {
    const chunk = await db
      .selectFrom("emails")
      .select(["id", "message_id_header", "folder", "status", "in_reply_to"])
      .where("org_id", "=", ctx.orgId)
      .where("mailbox_id", "=", mailboxId)
      .where("message_id_header", "in", messageIds.slice(start, start + MESSAGE_ID_CHUNK))
      .execute();
    for (const row of chunk) {
      if (row.message_id_header !== null) rows.push({ ...row, message_id_header: row.message_id_header });
    }
  }
  return rows;
}

// Gives stored real INBOX mail of the window that the worker skipped as `too_old` a new triage run. No audit: the caller writes it.
export async function requeueTooOld(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; now: Date }
): Promise<string[]> {
  const rows = await trx
    .updateTable("emails")
    .set({ status: "pending", skip_reason: null, next_attempt_at: null, backfilled_at: opts.now })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("folder", "=", "INBOX")
    .where("status", "=", "skipped")
    .where("skip_reason", "=", "too_old")
    .where("received_at", ">=", opts.since)
    .where(mailKindFilter("real"))
    .returning("id")
    .execute();
  return rows.map((row) => row.id);
}
