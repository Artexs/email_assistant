import { randomUUID } from "node:crypto";

import type { Insertable, Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

// Rows for the tests of the open loop tables. Raw inserts: the repository of the loops comes with a later stage.

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
      subject: overrides.subject === undefined ? "Confidential reorganisation of the audit team" : overrides.subject,
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
      subject: "Confidential reorganisation of the audit team",
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

// `applied` and `undone` rows need `applied_at`.
function appliedAtOf(status: string | undefined, createdAt: Date): Date | null {
  return status === "applied" || status === "undone" ? createdAt : null;
}

// A hand-inserted follow-up pair anchored on a loop (`loop_id` set, `email_id` null): the `create_draft` row and the
// `send` row that depends on it. No code makes such rows yet, so the readers that must not see them are tested with these.
// The payloads are placeholders: no reader parses them. `send` replaces single columns of the send row. Returns both ids.
export async function insertLoopActionPair(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  loopId: string,
  opts: {
    draftStatus?: string;
    sendStatus?: string;
    createdAt?: Date;
    notifiedAt?: Date | null;
    payloadMarker?: string;
    setId?: string;
    // Real payloads (a follow-up that the committer builds): replace the placeholders.
    payloads?: { draft: object; send: object };
    draft?: Partial<Insertable<DB["actions"]>>;
    send?: Partial<Insertable<DB["actions"]>>;
  } = {}
): Promise<{ draftId: string; sendId: string }> {
  const createdAt = opts.createdAt ?? new Date();
  const payload = JSON.stringify({ kind: "follow_up", marker: opts.payloadMarker ?? "placeholder" });
  const sendPayload = JSON.stringify({
    kind: "follow_up",
    marker: opts.payloadMarker ?? "placeholder",
    ...(opts.setId === undefined ? {} : { set_id: opts.setId }),
  });
  const draft = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      email_id: null,
      loop_id: loopId,
      type: "create_draft",
      status: opts.draftStatus ?? "ready",
      payload: opts.payloads === undefined ? payload : JSON.stringify(opts.payloads.draft),
      idempotency_key: `test:${randomUUID()}`,
      created_at: createdAt,
      applied_at: appliedAtOf(opts.draftStatus, createdAt),
      ...opts.draft,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const send = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      email_id: null,
      loop_id: loopId,
      type: "send",
      status: opts.sendStatus ?? "awaiting_approval",
      payload: opts.payloads === undefined ? sendPayload : JSON.stringify(opts.payloads.send),
      idempotency_key: `test:${randomUUID()}`,
      depends_on_action_id: draft.id,
      notified_at: opts.notifiedAt ?? null,
      created_at: createdAt,
      applied_at: appliedAtOf(opts.sendStatus, createdAt),
      ...opts.send,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { draftId: draft.id, sendId: send.id };
}
