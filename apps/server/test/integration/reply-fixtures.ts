import { randomUUID } from "node:crypto";

import type { Insertable, Transaction } from "kysely";

import type { DB, TenantContext } from "../../src/platform/db";

// Rows of the F115 tables for the integration tests.
export type ReplyRequestOverrides = Partial<Insertable<DB["reply_requests"]>>;

// One `reply_requests` row for a mail; the defaults are a valid automatic request.
export async function insertReplyRequest(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  emailId: string,
  overrides: ReplyRequestOverrides = {}
): Promise<string> {
  const row = await trx
    .insertInto("reply_requests")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      email_id: emailId,
      thread_key: `<${randomUUID()}@x.test>`,
      folder: "INBOX",
      trigger: "auto",
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// One `mailbox_profiles` row (the mailbox id is its key).
export async function insertMailboxProfile(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  overrides: Partial<Insertable<DB["mailbox_profiles"]>> = {}
): Promise<void> {
  await trx
    .insertInto("mailbox_profiles")
    .values({ mailbox_id: mailboxId, org_id: ctx.orgId, ...overrides })
    .execute();
}
