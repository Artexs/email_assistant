import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

// The name, the signature and the writing style of one mailbox (F115, D13). Every text is optional: null means "use the fallback".
// `signature` starts as a copy of `organizations.style_text` (the migration of stage 03). The copy is a snapshot: a later
// change of the organization text does not reach it, and a mailbox that was made after the migration has no row.
// Fallback order (decision N5, read by stage 04 and stage 11): `signature` null or no row → `organizations.style_text` → owner name.
export interface MailboxProfile {
  mailboxId: string;
  displayName: string | null;
  signature: string | null;
  writingStyle: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

// The fields that a write may set. A key that is left out keeps its stored value; null clears it. The stage 10 service
// turns an empty string into null before this call.
export interface MailboxProfileFields {
  displayName?: string | null;
  signature?: string | null;
  writingStyle?: string | null;
}

// Null when the mailbox has no profile row (also for a mailbox of another organization).
export async function mailboxProfileOf(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<MailboxProfile | null> {
  const row = await db
    .selectFrom("mailbox_profiles")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    mailboxId: row.mailbox_id,
    displayName: row.display_name,
    signature: row.signature,
    writingStyle: row.writing_style,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// Writes the profile of a mailbox: inserts the row or changes only the fields that the caller passes. The mailbox must be of
// the organization (the composite foreign key refuses another one). `updated_by` is the user who wrote. Returns the row.
export async function upsertMailboxProfile(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  fields: MailboxProfileFields,
  userId: string | null
): Promise<MailboxProfile> {
  const values = {
    ...(fields.displayName === undefined ? {} : { display_name: fields.displayName }),
    ...(fields.signature === undefined ? {} : { signature: fields.signature }),
    ...(fields.writingStyle === undefined ? {} : { writing_style: fields.writingStyle }),
  };
  await trx
    .insertInto("mailbox_profiles")
    .values({ mailbox_id: mailboxId, org_id: ctx.orgId, updated_by: userId, ...values })
    .onConflict((oc) =>
      oc
        .column("mailbox_id")
        .doUpdateSet({ ...values, updated_by: userId, updated_at: new Date() })
        .where("mailbox_profiles.org_id", "=", ctx.orgId)
    )
    .execute();
  const profile = await mailboxProfileOf(trx, ctx, mailboxId);
  if (!profile) throw new Error("mailbox profile missing after upsert");
  return profile;
}
