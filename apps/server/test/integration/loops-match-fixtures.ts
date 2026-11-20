import { randomUUID } from "node:crypto";

import { DAY_MS } from "@ea/core";
import type { Insertable, Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { loopsOrg } from "./loops-analyze-fixtures";
import { insertLoopRow } from "./loops-fixtures";
import type { Org } from "./mail-sent-fixtures";

// Shared rows of the reply-match tests.

export { loopsOrg };

export { DAY_MS } from "@ea/core";
export const WAIT_FROM = new Date("2026-11-10T10:00:00Z");
export const after = (days: number): Date => new Date(WAIT_FROM.getTime() + days * DAY_MS);
// The clock of a run: five days after the wait began.
export const RUN_AT = after(5);
export const ANNA = "anna@example.test";
export const JAN = "jan@example.test";
export const SUBJECT = "Oferta Q1";

export interface Reply {
  from?: string | null;
  at?: Date;
  subject?: string | null;
  threadKey?: string;
  inReplyTo?: string | null;
  references?: string | null;
  autoSubmitted?: string | null;
  precedence?: string | null;
  mailboxId?: string;
  // A fixed id (to sort against the order of receipt), the folder the mail came from, a triage category.
  id?: string;
  sourceFolder?: string;
  category?: string;
}

// One incoming mail with an optional `email_headers` row. Returns its id.
export async function reply(trx: Transaction<DB>, org: Org, opts: Reply = {}): Promise<string> {
  const values: Insertable<DB["emails"]> = {
    ...(opts.id === undefined ? {} : { id: opts.id }),
    ...(opts.sourceFolder === undefined ? {} : { source_folder: opts.sourceFolder }),
    org_id: org.ctx.orgId,
    mailbox_id: opts.mailboxId ?? org.mailboxId,
    dedup_key: `test:${randomUUID()}`,
    thread_key: opts.threadKey ?? `<${randomUUID()}@other.test>`,
    content_hash: "h",
    uid: Math.floor(Math.random() * 1_000_000_000),
    received_at: opts.at ?? after(3),
    status: "done",
    from_address: opts.from === undefined ? ANNA : opts.from,
    subject: opts.subject === undefined ? `Re: ${SUBJECT}` : opts.subject,
    in_reply_to: opts.inReplyTo ?? null,
    references_header: opts.references ?? null,
  };
  const row = await trx.insertInto("emails").values(values).returning("id").executeTakeFirstOrThrow();
  if (opts.category !== undefined) {
    await trx
      .insertInto("triage_results")
      .values({
        org_id: org.ctx.orgId,
        email_id: row.id,
        category: opts.category,
        confidence: 0.9,
        reason_code: "direct_request",
        created_at: new Date(),
      })
      .execute();
  }
  if (opts.autoSubmitted !== undefined || opts.precedence !== undefined) {
    await trx
      .insertInto("email_headers")
      .values({
        email_id: row.id,
        org_id: org.ctx.orgId,
        auto_submitted: opts.autoSubmitted ?? null,
        precedence: opts.precedence ?? null,
        parts_known: true,
        captured_at: new Date(),
      })
      .execute();
  }
  return row.id;
}

// An open `waiting` loop of `org` that waits since `WAIT_FROM`, To anna, Cc jan.
export async function waiting(
  trx: Transaction<DB>,
  org: Org,
  over: Partial<Insertable<DB["open_loops"]>> = {}
): Promise<{ id: string; threadKey: string; messageId: string }> {
  const threadKey = `<root-${randomUUID()}@own.test>`;
  const messageId = `<last-${randomUUID()}@own.test>`;
  const id = await insertLoopRow(trx, org.ctx, org.mailboxId, {
    thread_key: threadKey,
    message_id: messageId,
    to_addresses: [ANNA],
    cc_addresses: [JAN],
    counterpart: ANNA,
    subject: SUBJECT,
    wait_from_at: WAIT_FROM,
    ...over,
  });
  return { id, threadKey, messageId };
}

export async function loopRow(conn: Pick<Transaction<DB>, "selectFrom">, id: string) {
  return conn.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function closedAudit(conn: Pick<Transaction<DB>, "selectFrom">, orgId: string, loopId: string) {
  const rows = await conn
    .selectFrom("audit_log")
    .select(["event", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "loop.closed")
    .execute();
  return rows.filter((row) => (row.data as { loop_id?: string }).loop_id === loopId);
}

// The junk folder of the mailbox, as the sync stores it.
export async function junkFolder(trx: Transaction<DB>, org: Org, path = "Junk"): Promise<string> {
  await trx
    .insertInto("mailbox_folders")
    .values({ org_id: org.ctx.orgId, mailbox_id: org.mailboxId, key: "junk", path, role: "junk" })
    .execute();
  return path;
}

// `count` mails from `from` inside the 30 days, with a subject that is not the loop subject. Returns nothing.
export async function recipientMails(trx: Transaction<DB>, org: Org, from: string, count: number): Promise<void> {
  const rows: Insertable<DB["emails"]>[] = Array.from({ length: count }, (_, i) => ({
    org_id: org.ctx.orgId,
    mailbox_id: org.mailboxId,
    dedup_key: `test:${randomUUID()}`,
    thread_key: `<${randomUUID()}@other.test>`,
    content_hash: "h",
    uid: 2_000_000 + i,
    received_at: new Date(after(1).getTime() + i * 1000),
    status: "done",
    from_address: from,
    subject: `Other ${i}`,
  }));
  await trx.insertInto("emails").values(rows).execute();
}
