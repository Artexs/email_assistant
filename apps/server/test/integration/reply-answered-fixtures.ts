// Helpers of the tests of the answered pass and the sweep. The mail client of a test is a second IMAP connection of the
// same GreenMail user; the user's own reply is an APPEND to the Sent folder.
import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";
import type { Transaction } from "kysely";
import MailComposer from "nodemailer/lib/mail-composer";

import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { writeSentSwitch } from "../../src/modules/mail/repo";
import { setOrgFeature, upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import { NOW, type CopyBox } from "./copy-hash-fixtures";
import { insertDraftAndSend, insertTestEmail, createOrgWithMailbox } from "./fixtures";

// "Track my sent mail" on: the org flag `sent_sync` and the switch of the mailbox.
export async function sentSyncOn(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string): Promise<void> {
  await upsertOrgFeature(trx, ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: NOW });
  await writeSentSwitch(trx, ctx, mailboxId, { enabled: true, at: new Date(NOW.getTime() - HOUR_MS) });
}

// Only the org flag: the switch of the mailbox stays off, so the Sent mail is not read.
export async function sentSyncFlagOnly(trx: Transaction<DB>, ctx: TenantContext): Promise<void> {
  await upsertOrgFeature(trx, ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: NOW });
}

export async function messageIdOf(trx: Transaction<DB>, emailId: string): Promise<string> {
  const row = await trx
    .selectFrom("emails")
    .select("message_id_header")
    .where("id", "=", emailId)
    .executeTakeFirstOrThrow();
  if (row.message_id_header === null) throw new Error("the mail has no Message-ID");
  return row.message_id_header;
}

// The user answers `parentMessageId` in the mail client: a mail in the Sent folder with `In-Reply-To`, sent at `at`.
export async function appendUserReply(
  box: CopyBox,
  parentMessageId: string,
  at: Date,
  extra: { to?: string; subject?: string; headers?: Record<string, string> } = {}
): Promise<number> {
  const raw = await new MailComposer({
    from: box.address,
    to: extra.to ?? "boss@x.test",
    subject: extra.subject ?? "Re: Offer",
    ...(extra.headers === undefined ? {} : { headers: extra.headers }),
    text: "My own answer",
    inReplyTo: parentMessageId,
    references: parentMessageId,
    messageId: `<user-${randomUUID()}@x.test>`,
    date: at,
  })
    .compile()
    .build();
  const appended = await box.mailClient.appendMessage("Sent", raw, ["\\Seen"], at);
  if (appended.uid === null) throw new Error("the server gave no UID");
  return appended.uid;
}

// A mail in the thread of `emailId` (same mailbox and thread key), received at `receivedAt`. `autoSubmitted`: the captured header.
export async function addThreadMail(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  opts: { receivedAt: Date; autoSubmitted?: string; uid?: number }
): Promise<string> {
  const original = await trx
    .selectFrom("emails")
    .select(["mailbox_id", "thread_key"])
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .executeTakeFirstOrThrow();
  const id = await insertTestEmail(trx, ctx, original.mailbox_id, {
    thread_key: original.thread_key,
    status: "triaged",
    received_at: opts.receivedAt,
    uid: opts.uid ?? 900 + Math.floor(Math.random() * 90_000),
    message_id_header: `<thread-${randomUUID()}@x.test>`,
    from_address: "boss@x.test",
  });
  if (opts.autoSubmitted !== undefined) {
    await trx
      .insertInto("email_headers")
      .values({
        email_id: id,
        org_id: ctx.orgId,
        auto_submitted: opts.autoSubmitted,
        parts_known: true,
        captured_at: opts.receivedAt,
      })
      .execute();
  }
  return id;
}

// The sweep tests: an organization with a mailbox that may hold reply drafts, and reply pairs in it.
export const T0 = new Date("2026-11-20T10:00:00Z");
export const SWEEP_NOW = new Date("2026-11-20T13:00:00Z");
export const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };

export interface SweepOrg {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
}

// An organization with the flag `reply_drafts`, a mailbox in `assist` mode with the switch `reply_drafts` on.
export async function sweepOrg(trx: Transaction<DB>): Promise<SweepOrg> {
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await setOrgFeature(trx, ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: T0 });
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  await updateMailboxSettings(trx, ctx, created.mailboxId, { mode: "assist", toolSwitches: SWITCHES });
  await trx
    .updateTable("mailbox_settings")
    .set({ tool_switches: JSON.stringify({ ...SWITCHES, reply_drafts: true }) })
    .where("mailbox_id", "=", created.mailboxId)
    .execute();
  return { ctx, userId: created.userId, mailboxId: created.mailboxId };
}

export interface ReplyOpts {
  status?: "awaiting_approval" | "approved";
  lockedAt?: Date | null;
  createdAt?: Date;
  threadKey?: string;
  messageId?: string;
}

// A reply pair for a new mail of the mailbox. `approved`: the user tapped Send and the committer has not taken it.
export async function sweepReply(trx: Transaction<DB>, o: SweepOrg, opts: ReplyOpts = {}) {
  const status = opts.status ?? "awaiting_approval";
  const pair = await insertDraftAndSend(trx, o.ctx, o.mailboxId, {
    kind: "reply",
    createdAt: opts.createdAt ?? T0,
    from: "boss@x.test",
    subject: "Offer",
    messageId: opts.messageId ?? `<orig-${randomUUID()}@x.test>`,
    to: "boss@x.test",
    sendStatus: status,
    draftProviderResult: { folder: "Drafts", uid: 5 },
    ...(status === "approved" ? { approved: { userId: o.userId, at: T0 } } : {}),
    ...(opts.lockedAt === undefined ? {} : { lockedAt: opts.lockedAt }),
  });
  if (opts.threadKey !== undefined) {
    await trx.updateTable("emails").set({ thread_key: opts.threadKey }).where("id", "=", pair.emailId).execute();
  }
  return pair;
}

export async function markAnswered(trx: Transaction<DB>, o: SweepOrg, emailId: string): Promise<void> {
  await trx
    .insertInto("email_flags")
    .values({ email_id: emailId, org_id: o.ctx.orgId, seen: true, answered: true, flagged: false, checked_at: T0 })
    .execute();
}
