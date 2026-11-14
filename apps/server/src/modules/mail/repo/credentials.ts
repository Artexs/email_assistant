import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

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
