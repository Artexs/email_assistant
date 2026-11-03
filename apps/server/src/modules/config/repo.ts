import type { Selectable, Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

export type MailboxSettingsRow = Selectable<DB["mailbox_settings"]>;

// Uses the column defaults: mode "shadow", all switches OFF, no automatic moves.
export async function insertDefaultSettings(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<void> {
  await db.insertInto("mailbox_settings").values({ mailbox_id: mailboxId, org_id: ctx.orgId }).execute();
}

export async function getMailboxSettings(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<MailboxSettingsRow | undefined> {
  return db
    .selectFrom("mailbox_settings")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
}
