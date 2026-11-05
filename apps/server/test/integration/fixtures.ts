import { randomUUID } from "node:crypto";

import type { Transaction } from "kysely";

import type { MailCapabilities, NewEmail } from "../../src/modules/mail";
import { insertMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

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
