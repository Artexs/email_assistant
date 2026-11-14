import { mailboxStatuses, type FolderKey, type MailboxStatus as CoreMailboxStatus, type SmtpSecurity } from "@ea/core";
import { sql, type Selectable, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, TenantContext } from "../../../platform/db";
import type { MailCapabilities } from "../port";

import type { DbOrTrx } from "./shared";

export type MailboxRow = Omit<
  Selectable<DB["mailboxes"]>,
  "uidvalidity" | "last_uid" | "capabilities" | "folder_map" | "smtp_security"
> & {
  smtp_security: SmtpSecurity;
  uidvalidity: number | null;
  last_uid: number | null;
  capabilities: MailCapabilities | Record<string, never>;
  folder_map: Record<string, string>;
};
function toMailboxRow(row: Selectable<DB["mailboxes"]>): MailboxRow {
  return {
    ...row,
    smtp_security: row.smtp_security === "starttls" ? "starttls" : "tls",
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
    /** Left out: the column default `tls`. */
    smtpSecurity?: SmtpSecurity;
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
      smtp_security: input.smtpSecurity,
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
export async function findMailboxIdByAddress(
  db: DbOrTrx,
  ctx: TenantContext,
  address: string
): Promise<string | undefined> {
  const row = await db
    .selectFrom("mailboxes")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where(sql<string>`lower(address)`, "=", sql<string>`lower(${address})`)
    .executeTakeFirst();
  return row?.id;
}
// Every status counts: a paused or auth_error mailbox holds credentials and can be resumed.
export async function countMailboxesOfOrg(db: DbOrTrx, ctx: TenantContext): Promise<number> {
  const row = await db
    .selectFrom("mailboxes")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("org_id", "=", ctx.orgId)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}
// Serializes the connects of one organization until the transaction ends (D6). It needs a transaction:
// outside one, the lock ends with its own statement.
export async function lockMailboxLimit(db: DbOrTrx, ctx: TenantContext): Promise<void> {
  if (!db.isTransaction) throw new Error("lockMailboxLimit needs a transaction");
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mailbox_limit:${ctx.orgId}`}, 0))`.execute(db);
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
export async function markSynced(db: DbOrTrx, ctx: TenantContext, mailboxId: string, at: Date): Promise<void> {
  await db
    .updateTable("mailboxes")
    .set({ last_synced_at: at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .execute();
}
export type MailboxStatus = CoreMailboxStatus;
export const mailboxStatusSchema = z.enum(mailboxStatuses);
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
// With `seenChangedAt` it also needs the episode the caller read: a newer change of the same status stops the write.
// The compare is at millisecond precision, the precision of a JS Date.
export async function changeMailboxStatus(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  change: { from: MailboxStatus; to: MailboxStatus; at: Date; seenChangedAt?: Date }
): Promise<boolean> {
  let query = db
    .updateTable("mailboxes")
    .set({ status: change.to, status_changed_at: change.at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .where("status", "=", change.from);
  if (change.seenChangedAt !== undefined) {
    query = query.where(sql<boolean>`date_trunc('milliseconds', status_changed_at) = ${change.seenChangedAt}`);
  }
  const result = await query.executeTakeFirst();
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
const summaryColumns = ["id", "address", "status", "last_synced_at", "status_changed_at", "created_at"] as const;
export async function getMailboxSummary(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<MailboxSummary | undefined> {
  const row = await db
    .selectFrom("mailboxes")
    .select(summaryColumns)
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .executeTakeFirst();
  return row && { ...row, status: mailboxStatusSchema.parse(row.status) };
}
export async function listMailboxes(db: DbOrTrx, ctx: TenantContext): Promise<MailboxSummary[]> {
  const rows = await db
    .selectFrom("mailboxes")
    .select(summaryColumns)
    .where("org_id", "=", ctx.orgId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ ...row, status: mailboxStatusSchema.parse(row.status) }));
}
// The draft removal needs UIDPLUS (D13). An unknown mailbox counts as no UIDPLUS.
export async function mailboxHasUidplus(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  const mailbox = await getMailbox(db, ctx, mailboxId);
  return (mailbox?.capabilities as Partial<MailCapabilities> | undefined)?.uidplus === true;
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
