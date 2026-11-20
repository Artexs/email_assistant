import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";
import { expect } from "bun:test";
import type { Transaction } from "kysely";

import { sentOriginOf } from "../../src/modules/actions";
import type { SeedMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import {
  getSentSyncState,
  insertInboxFolder,
  insertMailbox,
  setFolderMapEntry,
  writeSentSwitch,
} from "../../src/modules/mail/repo";
import type { SentSyncDeps } from "../../src/modules/mail/sent-sync";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, testCapabilities } from "./fixtures";

// Shared setup of the Sent read tests.

export const NOW = new Date("2026-11-20T10:00:00Z");

export function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

export interface Org {
  ctx: TenantContext;
  mailboxId: string;
  userId: string;
  provider: FakeMailProvider;
}

// Flag on, switch on at NOW - 1 h, folder_map.sent = "Sent", a fake provider.
export async function newOrg(
  trx: Transaction<DB>,
  opts: { flag?: boolean; switchOn?: boolean; sentPath?: string | null } = {}
) {
  const created = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: created.orgId };
  if (opts.flag !== false) {
    await upsertOrgFeature(trx, ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: NOW });
  }
  if (opts.switchOn !== false) {
    await writeSentSwitch(trx, ctx, created.mailboxId, { enabled: true, at: ago(HOUR_MS) });
  }
  if (opts.sentPath !== null) await setFolderMapEntry(trx, ctx, created.mailboxId, "sent", opts.sentPath ?? "Sent");
  const org: Org = { ctx, mailboxId: created.mailboxId, userId: created.userId, provider: createFakeMailProvider() };
  return org;
}

// A second mailbox in the organization of `org`, set up like the first one, with its own fake provider.
export async function siblingMailbox(trx: Transaction<DB>, org: Org): Promise<Org> {
  const mailboxId = randomUUID();
  await insertMailbox(trx, org.ctx, {
    id: mailboxId,
    address: `box-${mailboxId}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: { drafts: "Drafts" },
  });
  await insertInboxFolder(trx, org.ctx, mailboxId);
  await writeSentSwitch(trx, org.ctx, mailboxId, { enabled: true, at: ago(HOUR_MS) });
  await setFolderMapEntry(trx, org.ctx, mailboxId, "sent", "Sent");
  return { ctx: org.ctx, mailboxId, userId: org.userId, provider: createFakeMailProvider() };
}

export function depsOf(trx: Transaction<DB>, org: Org, extra: Partial<SentSyncDeps> = {}): SentSyncDeps {
  return {
    db: trx,
    provider: org.provider,
    sentOriginOf: (ctx, mailboxId, actionId) => sentOriginOf(trx, ctx, mailboxId, actionId),
    now: () => NOW,
    ...extra,
  };
}

export function mail(n: number, at: Date, extra: Partial<SeedMessage> = {}): SeedMessage {
  return {
    messageId: `<sent${n}@x.test>`,
    from: "me@corp.test",
    to: [`to${n}@x.test`],
    subject: `Subject ${n}`,
    date: at,
    text: `Body ${n}`,
    ...extra,
  };
}

export function put(org: Org, n: number, at: Date, extra: Partial<SeedMessage> = {}, folder = "Sent"): number {
  return org.provider.deliver(folder, mail(n, at, extra), { internalDate: at });
}

export async function rowsOf(trx: Transaction<DB>, org: Org) {
  return trx
    .selectFrom("sent_emails")
    .selectAll()
    .where("org_id", "=", org.ctx.orgId)
    .where("mailbox_id", "=", org.mailboxId)
    .orderBy("uid")
    .orderBy("path")
    .execute();
}

export async function rowOf(trx: Transaction<DB>, org: Org, subject: string) {
  const rows = (await rowsOf(trx, org)).filter((row) => row.subject === subject);
  expect(rows).toHaveLength(1);
  return rows[0] as (typeof rows)[number];
}

export async function stateOf(trx: Transaction<DB>, org: Org) {
  const state = await getSentSyncState(trx, org.ctx, org.mailboxId);
  expect(state).toBeDefined();
  return state as NonNullable<typeof state>;
}
