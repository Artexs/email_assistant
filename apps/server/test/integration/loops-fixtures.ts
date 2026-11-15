import { randomUUID } from "node:crypto";

import type { Insertable, Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

// Rows for the tests of the open loop tables (F116). Raw inserts: the repository of the loops comes with a later stage.

const SENT_AT = new Date("2026-11-10T10:00:00Z");

// One `sent_emails` row of the user, with the text stored. Returns the id.
export async function insertSentRow(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  mailboxId: string,
  overrides: { toAddresses?: string[]; ccAddresses?: string[]; subject?: string | null; threadKey?: string } = {}
): Promise<string> {
  const row = await trx
    .insertInto("sent_emails")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      dedup_key: `mid:<${randomUUID()}@x.test>:h1`,
      path: "Sent",
      uidvalidity: "7",
      uid: "1",
      message_id: `<${randomUUID()}@x.test>`,
      thread_key: overrides.threadKey ?? `<${randomUUID()}@x.test>`,
      from_address: null,
      to_addresses: overrides.toAddresses ?? [],
      cc_addresses: overrides.ccAddresses ?? [],
      subject: overrides.subject === undefined ? "Quarterly numbers" : overrides.subject,
      body_text: "Can you send the numbers by Friday?",
      origin: "user",
      content: "stored",
      sent_at: SENT_AT,
      internal_date: SENT_AT,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// One open `waiting` loop; `overrides` replaces single columns. Returns the id.
export async function insertLoopRow(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  mailboxId: string,
  overrides: Partial<Insertable<DB["open_loops"]>> = {}
): Promise<string> {
  const row = await trx
    .insertInto("open_loops")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      kind: "waiting",
      thread_key: `<${randomUUID()}@x.test>`,
      message_id: `<${randomUUID()}@x.test>`,
      subject: "Quarterly numbers",
      to_addresses: ["counterpart@x.test"],
      counterpart: "counterpart@x.test",
      text: "send the numbers",
      language: "en",
      due_at: new Date("2026-11-14T10:00:00Z"),
      due_source: "default",
      wait_from_at: SENT_AT,
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// One `sent_analyses` row for a sent mail.
export async function insertAnalysisRow(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  mailboxId: string,
  sentEmailId: string,
  overrides: { status?: string; skip_reason?: string | null } = {}
): Promise<void> {
  await trx
    .insertInto("sent_analyses")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      sent_email_id: sentEmailId,
      status: overrides.status ?? "done",
      expects_reply: true,
      has_promise: false,
      prompt_version: "extractor-v1",
      ...overrides,
    })
    .execute();
}
