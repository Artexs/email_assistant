import type { Transaction } from "kysely";

import type { NewEmail } from "../../src/modules/mail";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";

export interface Tenant {
  ctx: TenantContext;
  mailboxId: string;
}

export async function createTwoTenants(trx: Transaction<DB>): Promise<{ a: Tenant; b: Tenant }> {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return {
    a: { ctx: { orgId: a.orgId }, mailboxId: a.mailboxId },
    b: { ctx: { orgId: b.orgId }, mailboxId: b.mailboxId },
  };
}

export function newEmail(mailboxId: string, overrides: Partial<NewEmail> = {}): NewEmail {
  return {
    mailbox_id: mailboxId,
    dedup_key: "mid:<1@x.test>:hash-1",
    message_id_header: "<1@x.test>",
    content_hash: "hash-1",
    uid: 1,
    source_folder: "INBOX",
    thread_key: "<1@x.test>",
    from_address: "sender@x.test",
    subject: "Hello",
    received_at: new Date("2026-11-03T10:00:00Z"),
    ...overrides,
  };
}

export async function emailRow(trx: Transaction<DB>, mailboxId: string, dedupKey: string) {
  return trx
    .selectFrom("emails")
    .select(["id", "org_id", "uid", "folder", "returned_at", "status"])
    .where("mailbox_id", "=", mailboxId)
    .where("dedup_key", "=", dedupKey)
    .executeTakeFirstOrThrow();
}
