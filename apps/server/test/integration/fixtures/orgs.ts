import { randomUUID } from "node:crypto";

import type { MembershipRole } from "@ea/core";
import type { Transaction } from "kysely";

import { noDelegationHooks, type ApplyDeps } from "../../../src/modules/actions";
import { composeMessage, type MailCapabilities } from "../../../src/modules/mail";
import { insertInboxFolder, insertMailbox } from "../../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../../src/modules/tenancy/repo";
import type { DB, TenantContext } from "../../../src/platform/db";

export const testCapabilities: MailCapabilities = {
  idle: true,
  move: true,
  uidplus: true,
  condstore: true,
  specialUse: true,
  keywords: true,
};
// The send fields of `ApplyDeps` for tests that apply no draft or send.
export function applyDepsDefaults(): Pick<
  ApplyDeps,
  "mailbox" | "owner" | "organization" | "compose" | "sender" | "hooks" | "appendFolders"
> {
  return {
    mailbox: { address: "box@x.test", capabilities: { uidplus: true }, folderMap: {} },
    owner: { displayName: "Owner" },
    organization: { timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: null,
    hooks: noDelegationHooks,
    appendFolders: new Set(),
  };
}
// Fixture users read English, so the text assertions keep their meaning; channels-locale.test.ts covers pl and null.
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
    locale: "en",
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
  await insertInboxFolder(trx, { orgId }, mailboxId);
  return { orgId, userId, mailboxId };
}
// Other tests and dev data leave active mailboxes in the DB; the job tests want only their own. The rollback undoes it.
export async function pauseOtherMailboxes(trx: Transaction<DB>): Promise<void> {
  await trx.updateTable("mailboxes").set({ status: "paused" }).where("status", "=", "active").execute();
}
// The plan state of the tests: a direct update, as the CLI's service does it (the hooks are not part of these tests).
export async function suspendOrg(trx: Transaction<DB>, orgId: string): Promise<void> {
  await trx.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", orgId).execute();
}
export async function resumeOrg(trx: Transaction<DB>, orgId: string, at: Date): Promise<void> {
  await trx.updateTable("organizations").set({ plan: "active", resumed_at: at }).where("id", "=", orgId).execute();
}
// A new user with a membership in the org; returns the user id.
export async function addMember(
  trx: Transaction<DB>,
  orgId: string,
  role: MembershipRole = "assistant"
): Promise<string> {
  const user = await insertUser(trx, {
    email: `member-${randomUUID()}@x.test`,
    displayName: "Member",
    locale: "en",
  });
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
