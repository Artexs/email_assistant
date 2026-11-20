import { format } from "node:util";

import { HOUR_MS } from "@ea/core";
import { expect, spyOn } from "bun:test";
import type { Transaction } from "kysely";

import {
  syncMailbox,
  type MailboxSyncResult,
  type MailProvider,
  type SeedMessage,
  type SyncDeps,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { updateCursor } from "../../src/modules/mail/repo";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox } from "./fixtures";

export const UID_VALIDITY = 7;

export interface Setup {
  ctx: TenantContext;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
}

export async function setup(trx: Transaction<DB>): Promise<Setup> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  const ctx = { orgId };
  const moved = await updateCursor(
    trx,
    ctx,
    mailboxId,
    { uidValidity: null, lastUid: null },
    { uidValidity: UID_VALIDITY, lastUid: 0 }
  );
  expect(moved).toBe(true);
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return { ctx, mailboxId, address: mailbox.address, fake: createFakeMailProvider({ uidValidity: UID_VALIDITY }) };
}

export const NOW = new Date("2026-11-03T12:00:00Z");

export function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR_MS);
}

export function deps(trx: Db | Transaction<DB>, provider: MailProvider, overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    db: trx,
    provider,
    isOwnActionId: async () => false,
    now: () => NOW,
    ...overrides,
  };
}

export function seed(n: number, overrides: Partial<SeedMessage> = {}): SeedMessage {
  return {
    messageId: `<m${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: new Date(Date.UTC(2026, 10, 3, 8, 0, n)),
    text: `Body ${n}`,
    ...overrides,
  };
}

export async function emails(trx: Db | Transaction<DB>, mailboxId: string) {
  return trx
    .selectFrom("emails")
    .select([
      "id",
      "dedup_key",
      "message_id_header",
      "uid",
      "folder",
      "returned_at",
      "status",
      "body_text",
      "thread_key",
      "references_header",
    ])
    .where("mailbox_id", "=", mailboxId)
    .orderBy("uid")
    .execute();
}

export async function cursorOf(trx: Db | Transaction<DB>, mailboxId: string) {
  const row = await trx
    .selectFrom("mailbox_folders")
    .select(["uidvalidity", "last_uid"])
    .where("mailbox_id", "=", mailboxId)
    .where("key", "=", "inbox")
    .executeTakeFirstOrThrow();
  return { uidValidity: Number(row.uidvalidity), lastUid: Number(row.last_uid) };
}

// Runs `hook` before the n-th call of fetchContent, then calls the fake.
export function onBodyCall(fake: FakeMailProvider, hook: (call: number) => Promise<void>): MailProvider {
  let call = 0;
  return {
    ...fake,
    serverInfo: () => fake.serverInfo(),
    folderStatus: (folder) => fake.folderStatus(folder),
    fetchAbove: (folder, lastUid) => fake.fetchAbove(folder, lastUid),
    fetchContent: async (folder, uid) => {
      call += 1;
      await hook(call);
      return fake.fetchContent(folder, uid);
    },
    close: () => fake.close(),
  };
}

export interface FolderCall {
  method: "fetchMetaIn" | "searchSinceIn" | "fetchByUidsIn";
  folder: string;
  uids?: number[];
}

// The fake with a record of the folder-aware read calls.
export function spyFolderReads(fake: FakeMailProvider): { provider: MailProvider; folderCalls: FolderCall[] } {
  const folderCalls: FolderCall[] = [];
  const provider: MailProvider = {
    ...fake,
    fetchMetaIn: (folder, uid) => {
      folderCalls.push({ method: "fetchMetaIn", folder, uids: [uid] });
      return fake.fetchMetaIn(folder, uid);
    },
    searchSinceIn: (folder, since) => {
      folderCalls.push({ method: "searchSinceIn", folder });
      return fake.searchSinceIn(folder, since);
    },
    fetchByUidsIn: (folder, uids) => {
      folderCalls.push({ method: "fetchByUidsIn", folder, uids });
      return fake.fetchByUidsIn(folder, uids);
    },
  };
  return { provider, folderCalls };
}

export async function movedRowOf(trx: Db | Transaction<DB>, mailboxId: string) {
  const row = await trx
    .selectFrom("emails")
    .select(["id", "uid", "source_uid", "folder", "returned_at", "moved_at"])
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return { ...row, uid: Number(row.uid), source_uid: Number(row.source_uid) };
}

// Every row of the mailbox with its capture row, in UID order.
export async function copyRowsOf(trx: Db | Transaction<DB>, mailboxId: string) {
  const rows = await trx
    .selectFrom("emails")
    .leftJoin("email_headers", "email_headers.email_id", "emails.id")
    .select([
      "emails.id",
      "emails.dedup_key",
      "emails.folder",
      "emails.source_folder",
      "emails.uid",
      "emails.source_uid",
      "emails.status",
      "emails.body_text",
      "emails.received_at",
      "emails.returned_at",
      "emails.move_pending_at",
      "email_headers.email_id as header_id",
    ])
    .where("emails.mailbox_id", "=", mailboxId)
    .orderBy("emails.dedup_key")
    .execute();
  return rows.map((row) => ({ ...row, uid: Number(row.uid), source_uid: Number(row.source_uid) }));
}

// Runs `fn` with the debug level on and returns the lines that the logger wrote. Resets the level.
export async function withDebugLines(fn: () => Promise<void>): Promise<string[]> {
  const out = spyOn(console, "log").mockImplementation(() => undefined);
  const err = spyOn(console, "error").mockImplementation(() => undefined);
  setLogLevel("debug");
  try {
    await fn();
    return [...out.mock.calls, ...err.mock.calls].map((call) => format(...call));
  } finally {
    setLogLevel("info");
    out.mockRestore();
    err.mockRestore();
  }
}

export const interia = (): FakeMailProvider =>
  createFakeMailProvider({ uidValidity: UID_VALIDITY, keepUidOnUserMove: true, capabilities: { move: false } });

// A stored mail (INBOX uid `uid`) that the system "moved" to AI/Info an hour ago.
export async function storeAndMark(trx: Transaction<DB>, s: Setup, movedAt: Date = hoursAgo(1)): Promise<number> {
  const uid = s.fake.deliver("INBOX", seed(1));
  await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
  await trx
    .updateTable("emails")
    .set({ folder: "AI/Info", moved_at: movedAt })
    .where("mailbox_id", "=", s.mailboxId)
    .execute();
  return uid;
}

export const OFFERS = "Oferty";

export const JUNK = "Wiadomości-śmieci";

export const FOLDER_NOW = new Date("2026-11-08T12:00:00Z");

export const ago = (hours: number): { internalDate: Date } => ({
  internalDate: new Date(FOLDER_NOW.getTime() - hours * HOUR_MS),
});

export const folderDeps = (trx: Db | Transaction<DB>, provider: MailProvider, overrides: Partial<SyncDeps> = {}) =>
  deps(trx, provider, { now: () => FOLDER_NOW, ...overrides });

// The Interia shape: one UID counter for the mailbox, no MOVE, a user move keeps the UID, STATUS UIDNEXT 1.
export async function folderSetup(trx: Transaction<DB>, opts: { keepUidOnUserMove?: boolean } = {}): Promise<Setup> {
  const s = await setup(trx);
  const fake = createFakeMailProvider({
    uidValidity: UID_VALIDITY,
    globalUids: true,
    keepUidOnUserMove: opts.keepUidOnUserMove ?? true,
    uidNextValue: 1,
    capabilities: { move: false },
  });
  return { ...s, fake };
}

export async function addFolderRow(
  trx: Db | Transaction<DB>,
  s: Setup,
  key: "offers" | "social" | "bills" | "junk",
  path: string,
  opts: { enabled?: boolean; lastUid?: number | null } = {}
): Promise<void> {
  await trx
    .insertInto("mailbox_folders")
    .values({
      org_id: s.ctx.orgId,
      mailbox_id: s.mailboxId,
      key,
      path,
      role: key === "junk" ? "junk" : "sort",
      enabled: opts.enabled ?? true,
      uidvalidity: opts.lastUid === undefined || opts.lastUid === null ? null : 1,
      last_uid: opts.lastUid ?? null,
    })
    .execute();
}

export async function folderRow(trx: Db | Transaction<DB>, mailboxId: string, key: string) {
  const row = await trx
    .selectFrom("mailbox_folders")
    .select(["uidvalidity", "last_uid", "enabled"])
    .where("mailbox_id", "=", mailboxId)
    .where("key", "=", key)
    .executeTakeFirst();
  return (
    row && {
      uidValidity: row.uidvalidity === null ? null : Number(row.uidvalidity),
      lastUid: row.last_uid === null ? null : Number(row.last_uid),
      enabled: row.enabled,
    }
  );
}

export async function storedRows(trx: Db | Transaction<DB>, mailboxId: string) {
  return trx
    .selectFrom("emails")
    .select(["uid", "source_uid", "folder", "source_folder", "status", "subject"])
    .where("mailbox_id", "=", mailboxId)
    .orderBy("uid")
    .execute();
}

export const of = (result: MailboxSyncResult, key: string) => result.folders.find((item) => item.folder === key);

export async function withLogs(fn: (lines: { warn: string[]; info: string[] }) => Promise<void>): Promise<void> {
  const warn = spyOn(console, "error").mockImplementation(() => undefined);
  const info = spyOn(console, "log").mockImplementation(() => undefined);
  try {
    await fn({
      get warn() {
        return warn.mock.calls.map((call) => format(...call));
      },
      get info() {
        return info.mock.calls.map((call) => format(...call));
      },
    });
  } finally {
    warn.mockRestore();
    info.mockRestore();
  }
}
