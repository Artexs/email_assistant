import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import { mailKindFilter } from "./emails";
import type { DbOrTrx } from "./shared";

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
export async function listFolderEmailKeys(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  folders: string[],
  since: Date
): Promise<{ message_id_header: string | null; content_hash: string }[]> {
  if (folders.length === 0) return [];
  return db
    .selectFrom("emails")
    .select(["message_id_header", "content_hash"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("folder", "in", folders)
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
