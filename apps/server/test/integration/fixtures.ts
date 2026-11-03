import { randomUUID } from "node:crypto";

import type { Transaction } from "kysely";

import type { MailCapabilities } from "../../src/modules/mail";
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
