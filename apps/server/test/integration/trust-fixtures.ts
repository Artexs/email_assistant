import { randomUUID } from "node:crypto";

import { sql, type Insertable, type Transaction } from "kysely";

import { insertDefaultSettings } from "../../src/modules/config";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import type { DB } from "../../src/platform/db";

import { testCapabilities } from "./fixtures";

// Rows for the tests of the trust tables. Raw inserts: the repository is the code under test elsewhere.

const GRANTED_AT = new Date("2026-11-10T10:00:00Z");

// One history check; `overrides` replaces single columns. Returns the id.
export async function insertCheckRow(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  mailboxId: string,
  overrides: Partial<Insertable<DB["history_checks"]>> = {}
): Promise<string> {
  const row = await trx
    .insertInto("history_checks")
    .values({ org_id: ctx.orgId, mailbox_id: mailboxId, reason: "connect", ...overrides })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// One decision of a check for one mail.
export async function insertCheckItemRow(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  checkId: string,
  emailId: string,
  overrides: Partial<Insertable<DB["history_check_items"]>> = {}
): Promise<void> {
  await trx
    .insertInto("history_check_items")
    .values({
      check_id: checkId,
      org_id: ctx.orgId,
      email_id: emailId,
      category: "info",
      confidence: 0.9,
      reason_code: "newsletter",
      would_move: true,
      source: "classified",
      ...overrides,
    })
    .execute();
}

// One active trip. Returns the id.
export async function insertTripRow(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  mailboxId: string,
  overrides: Partial<Insertable<DB["autonomy_trips"]>> = {}
): Promise<string> {
  const row = await trx
    .insertInto("autonomy_trips")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      category: "info",
      granted_at: GRANTED_AT,
      reason: "corrections",
      counts: JSON.stringify({ corrections: 2 }),
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// A second mailbox of an organization, with its INBOX folder and default settings. Returns the id.
export async function addMailbox(trx: Transaction<DB>, ctx: { orgId: string }): Promise<string> {
  const id = randomUUID();
  await insertMailbox(trx, ctx, {
    id,
    address: `second-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await insertInboxFolder(trx, ctx, id);
  await insertDefaultSettings(trx, ctx, id);
  return id;
}

// The `delete_mailbox` function (the only delete path of a mailbox), run as the app role.
export async function deleteMailboxRow(trx: Transaction<DB>, ctx: { orgId: string }, mailboxId: string): Promise<void> {
  await sql`select delete_mailbox(${ctx.orgId}::uuid, ${mailboxId}::uuid)`.execute(trx);
}
