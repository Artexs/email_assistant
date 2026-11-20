import { randomUUID } from "node:crypto";

import { type Transaction } from "kysely";

import {
  approve,
  createExpiryJob,
  noApprovalHooks,
  noDelegationHooks,
  type ApprovalDeps,
  type ApprovalHooks,
} from "../../src/modules/actions";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, pauseOtherMailboxes } from "./fixtures";

export const NOW = new Date("2026-11-20T10:00:00Z");
export const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
export const TO = "jan@x.test";
export const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };

export interface World {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  sender: FakeMailSender;
  folderMap: Record<string, string>;
}

// `flag`: the org flag `reply_drafts` (on by default here). The mailbox is in assist mode with the reply switch on.
export async function world(trx: Transaction<DB>, opts: { flag?: boolean } = {}): Promise<World> {
  await pauseOtherMailboxes(trx);
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", box.mailboxId)
    .executeTakeFirstOrThrow();
  const folderMap = { drafts: "Drafts", sent: "Sent" };
  await trx
    .updateTable("mailboxes")
    .set({ folder_map: JSON.stringify(folderMap) })
    .where("id", "=", box.mailboxId)
    .execute();
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  await updateMailboxSettings(trx, ctx, box.mailboxId, { mode: "assist", toolSwitches: SWITCHES });
  await trx
    .updateTable("mailbox_settings")
    .set({ tool_switches: JSON.stringify({ ...SWITCHES, reply_drafts: true }) })
    .where("mailbox_id", "=", box.mailboxId)
    .execute();
  if (opts.flag !== false) {
    await setOrgFeature(trx, ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: NOW });
  }
  const fake = createFakeMailProvider();
  await fake.ensureFolder("Drafts");
  await fake.ensureFolder("Sent");
  return {
    ctx,
    userId: box.userId,
    mailboxId: box.mailboxId,
    address: mailbox.address,
    fake,
    sender: createFakeMailSender(),
    folderMap,
  };
}

export type Pair = Parameters<typeof insertDraftAndSend>[3];

// A waiting reply send (draft `applied`, as the approve needs) made `createdAgo` ago, with the fields of `opts`.
export async function reply(trx: Transaction<DB>, w: World, createdAgo: number, opts: Pair = {}) {
  return insertDraftAndSend(trx, w.ctx, w.mailboxId, {
    kind: "reply",
    createdAt: ago(createdAgo),
    draftProviderResult: { folder: "Drafts", uid: 7 },
    to: TO,
    from: TO,
    subject: "Offer",
    messageId: `<orig-${randomUUID()}@x.test>`,
    bodyText: "Please send the offer.",
    ...opts,
  });
}

export const approvalDeps = (trx: Transaction<DB>, hooks: ApprovalHooks = noApprovalHooks): ApprovalDeps => ({
  db: trx,
  hooks: noDelegationHooks,
  approvalHooks: hooks,
  uidplus: async () => true,
});

export const tap = (trx: Transaction<DB>, w: World, sendId: string, now: Date = NOW) =>
  approve(approvalDeps(trx), w.ctx, sendId, { userId: w.userId, via: "telegram", now });

export const expiryJob = (trx: Transaction<DB>, now: Date = NOW) =>
  createExpiryJob({ db: trx, now: () => now, hooks: noDelegationHooks, uidplus: async () => true });

export async function row(conn: Db | Transaction<DB>, id: string) {
  return conn.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function auditRows(conn: Db | Transaction<DB>, actionId: string, event: string) {
  return conn
    .selectFrom("audit_log")
    .selectAll()
    .where("action_id", "=", actionId)
    .where("event", "=", event)
    .execute();
}
