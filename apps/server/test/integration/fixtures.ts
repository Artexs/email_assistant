import { randomUUID } from "node:crypto";

import type { Category, MembershipRole } from "@ea/core";
import type { Transaction } from "kysely";

import type { MailCapabilities, NewEmail } from "../../src/modules/mail";
import { insertMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import type { DB, TenantContext } from "../../src/platform/db";

export const testCapabilities: MailCapabilities = {
  idle: true,
  move: true,
  uidplus: true,
  condstore: true,
  specialUse: true,
  keywords: true,
};

export async function createOrgWithMailbox(
  trx: Transaction<DB>,
  opts?: { address?: string }
): Promise<{ orgId: string; userId: string; mailboxId: string }> {
  const suffix = randomUUID();
  const { orgId, userId } = await createOrganizationWithOwner(trx, {
    orgName: `Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `owner-${suffix}@x.test`,
    displayName: "Owner",
  });
  const mailboxId = randomUUID();
  await insertMailbox(
    trx,
    { orgId },
    {
      id: mailboxId,
      address: opts?.address ?? `box-${suffix}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: { drafts: "Drafts" },
    }
  );
  return { orgId, userId, mailboxId };
}

export async function insertTestEmail(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  mailboxId: string,
  overrides?: Partial<NewEmail> & {
    status?: string;
    attempts?: number;
    next_attempt_at?: Date | null;
    locked_at?: Date | null;
    backfilled_at?: Date | null;
  }
): Promise<string> {
  const row = await trx
    .insertInto("emails")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      dedup_key: `test:${randomUUID()}`,
      thread_key: `test:${randomUUID()}`,
      content_hash: "h",
      uid: 1,
      received_at: new Date(),
      status: "pending",
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// Other tests and dev data leave active mailboxes in the DB; the job tests want only their own. The rollback undoes it.
export async function pauseOtherMailboxes(trx: Transaction<DB>): Promise<void> {
  await trx.updateTable("mailboxes").set({ status: "paused" }).where("status", "=", "active").execute();
}

// A new user with a membership in the org; returns the user id.
export async function addMember(
  trx: Transaction<DB>,
  orgId: string,
  role: MembershipRole = "assistant"
): Promise<string> {
  const user = await insertUser(trx, { email: `member-${randomUUID()}@x.test`, displayName: "Member" });
  await insertMembership(trx, { orgId }, { userId: user.id, role });
  return user.id;
}

export async function linkChat(
  trx: Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  chatId: number,
  linkedAt: Date
): Promise<void> {
  await trx
    .insertInto("chat_links")
    .values({ org_id: ctx.orgId, user_id: userId, channel: "telegram", external_chat_id: chatId, linked_at: linkedAt })
    .execute();
}

// Between 10^9 and 10^12, so a test never collides with a real chat id in the dev DB.
export function randomChatId(): number {
  return 1_000_000_000 + Math.floor(Math.random() * (1_000_000_000_000 - 1_000_000_000));
}

// An `emails` row (status `triaged`) and a `triage_results` row with the given `created_at`; returns the e-mail id.
export async function insertTriaged(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: {
    category: Category;
    createdAt: Date;
    receivedAt?: Date;
    reason?: string | null;
    reasonCode?: string;
    confidence?: number;
    fields?: Record<string, unknown>;
    subject?: string | null;
    from?: string | null;
    messageId?: string | null;
  }
): Promise<string> {
  const emailId = await insertTestEmail(trx, ctx, mailboxId, {
    status: "triaged",
    received_at: opts.receivedAt ?? opts.createdAt,
    subject: opts.subject ?? null,
    from_address: opts.from ?? null,
    message_id_header: opts.messageId ?? null,
  });
  await trx
    .insertInto("triage_results")
    .values({
      org_id: ctx.orgId,
      email_id: emailId,
      category: opts.category,
      confidence: opts.confidence ?? 0.9,
      reason_code: opts.reasonCode ?? "direct_request",
      reason: opts.reason ?? null,
      fields: JSON.stringify(opts.fields ?? {}),
      created_at: opts.createdAt,
    })
    .execute();
  return emailId;
}

// The dev DB can hold chat links and outbox rows from manual runs; jobs that read all organizations want only their own.
// The rollback undoes it.
export async function isolateChannels(trx: Transaction<DB>): Promise<void> {
  await trx.deleteFrom("chat_links").execute();
  await trx
    .updateTable("outbox")
    .set({ status: "failed", error_code: "outdated", locked_at: null })
    .where("status", "in", ["pending", "sending"])
    .execute();
}
