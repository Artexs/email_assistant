import { DAY_MS, HOUR_MS } from "@ea/core";
import { expect } from "bun:test";
import type { Transaction } from "kysely";

import { syncMailbox, type MailProvider, type SeedMessage, type SyncDeps } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";

export const UID_VALIDITY = 7;

export const NOW = new Date("2026-11-03T12:00:00Z");

export const SINCE_DAYS = 30;

export const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

export function seed(n: number): SeedMessage {
  return {
    messageId: `<h${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: NOW,
    text: `Body ${n}`,
  };
}

export function deps(trx: Db | Transaction<DB>, provider: MailProvider): SyncDeps {
  return { db: trx, provider, isOwnActionId: async () => false, now: () => NOW };
}

// Mailbox with a synced INBOX: h1 (40 days old, outside the window), h2 (20 days), h3 (10 days), h4 (2 hours; the initial sync stores it).
export async function syncedMailbox(trx: Transaction<DB>) {
  const { orgId, mailboxId, userId } = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId };
  const fake = createFakeMailProvider({ uidValidity: UID_VALIDITY });
  fake.deliver("INBOX", seed(1), { internalDate: ago(40 * DAY_MS) });
  fake.deliver("INBOX", seed(2), { internalDate: ago(20 * DAY_MS) });
  fake.deliver("INBOX", seed(3), { internalDate: ago(10 * DAY_MS) });
  fake.deliver("INBOX", seed(4), { internalDate: ago(2 * HOUR_MS) });
  const initial = await syncMailbox(deps(trx, fake), ctx, mailboxId);
  expect(initial.stored).toBe(1);
  return { ctx, mailboxId, userId, fake };
}

export async function rowsOf(trx: Db | Transaction<DB>, mailboxId: string) {
  return trx
    .selectFrom("emails")
    .selectAll()
    .where("mailbox_id", "=", mailboxId)
    .orderBy("message_id_header")
    .execute();
}

export const byId = <T extends { message_id_header: string | null }>(rows: T[], n: number): T => {
  const row = rows.find((candidate) => candidate.message_id_header === `<h${n}@x.test>`);
  if (row === undefined) throw new Error(`no row for h${n}`);
  return row;
};

export async function cursorOf(trx: Db | Transaction<DB>, mailboxId: string) {
  return trx
    .selectFrom("mailbox_folders")
    .select(["uidvalidity", "last_uid"])
    .where("mailbox_id", "=", mailboxId)
    .where("key", "=", "inbox")
    .executeTakeFirstOrThrow();
}

export const sinceOf = (days = SINCE_DAYS) => ago(days * DAY_MS);
