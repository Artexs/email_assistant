import { randomUUID } from "node:crypto";

import {
  planDelivery,
  SYNC_FOLDER_DEFAULTS,
  syncFolderDefaultPath,
  sortFolderKeys,
  type CaseDelivery,
  type FoundCopy,
  type SyncFolderKey,
  type SortFolderKey,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { createLog } from "../../platform/log";

import { compareFolderWithDb, type AuditCounts } from "./audit";
import { openImapProvider, type ImapConnectOptions } from "./imap/client";
import { assertTestAddress } from "./imap/probe-move";
import { appendRaw } from "./imap/tools";
import { LOCATE_CHUNK } from "./locate";
import { INBOX, MailFolderMissingError, MailNotFoundError, type MailProvider, type MessageMeta } from "./port";
import {
  getCredentials,
  getMailbox,
  listEmailsByMessageIds,
  listFolderEmailKeys,
  listSyncFolders,
  type MailboxRow,
} from "./repo";
import { renderSeedMessage, SYNTHETIC_MESSAGE_ID_DOMAIN, type SeedMessage } from "./seed";
import { backfillInbox, fetchSince, type SyncDeps, type SyncResult } from "./sync";
import { contentHash, normalizeMessageId } from "./sync-rules";

// Operator tools for the 48-hour run (`mailbox:seed`, `mailbox:audit`, `mailbox:signals`, `testmail-target deliver`).

const log = createLog("mail");

export interface ToolDeps {
  db: Db | Transaction<DB>;
  secrets: SecretBox;
}

async function getMailboxOrThrow(deps: ToolDeps, ctx: TenantContext, mailboxId: string): Promise<MailboxRow> {
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (mailbox === undefined) throw new HardError("mailbox not found");
  return mailbox;
}

async function loadImapOptions(
  deps: ToolDeps,
  ctx: TenantContext,
  mailboxId: string,
  mailbox: MailboxRow
): Promise<ImapConnectOptions> {
  const credentials = await getCredentials(deps.db, ctx, mailboxId);
  if (credentials === undefined) throw new HardError("mailbox has no stored password");
  const password = deps.secrets.decrypt(
    { ciphertext: credentials.encrypted_secret, keyVersion: credentials.key_version },
    `mailbox:${mailboxId}`
  );
  return { host: mailbox.imap_host, port: mailbox.imap_port, user: mailbox.address, password };
}

/**
 * APPENDs `count` synthetic mails into INBOX or `folder` (or, with `messages`, each message once; `count` is then ignored). It refuses, before any connection, unless `testAddress`
 * is set and equals the mailbox address (case-insensitive), so it never writes into a real mailbox. `folder` is INBOX (default) or the path of a sync folder
 * default; it must exist (the tool creates only INBOX).
 */
export async function seedMailbox(
  deps: ToolDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: { count: number; testAddress: string | undefined; messages?: SeedMessage[]; folder?: string }
): Promise<number> {
  const mailbox = await getMailboxOrThrow(deps, ctx, mailboxId);
  const address = mailbox.address;
  if (opts.testAddress === undefined) throw new HardError("TEST_MAILBOX_ADDRESS is not set: seed refused");
  if (opts.testAddress.trim().toLowerCase() !== address.toLowerCase()) {
    throw new HardError("the mailbox is not the test mailbox (TEST_MAILBOX_ADDRESS): seed refused");
  }
  const folder = opts.folder ?? INBOX;
  if (folder !== INBOX && !SYNC_FOLDER_DEFAULTS.some((item) => item.path === folder)) {
    throw new HardError("the folder is not INBOX or a sync folder: seed refused");
  }
  const create = folder === INBOX;
  const imap = await loadImapOptions(deps, ctx, mailboxId, mailbox);
  if (opts.messages !== undefined) {
    for (const message of opts.messages) await appendRaw(imap, folder, renderSeedMessage(message), [], create);
    return opts.messages.length;
  }
  for (let n = 0; n < opts.count; n += 1) {
    const now = new Date();
    const raw = renderSeedMessage({
      messageId: `<seed-${randomUUID()}@${SYNTHETIC_MESSAGE_ID_DOMAIN}>`,
      from: "seed@ea-seed.test",
      to: [address],
      subject: `EA seed ${now.toISOString()}`,
      date: now,
      text: "Synthetic mail from mailbox:seed.",
      headers: { "X-EA-Seed": "1" },
    });
    await appendRaw(imap, folder, raw, [], create);
  }
  return opts.count;
}

/**
 * Read-only: compares the mail since `since` of every enabled synced folder (INBOX first) with the stored rows of that folder.
 * `counts` is null when the server does not list the folder.
 */
export async function auditMailbox(
  deps: ToolDeps,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<{ key: SyncFolderKey; counts: AuditCounts | null }[]> {
  const imap = await loadImapOptions(deps, ctx, mailboxId, await getMailboxOrThrow(deps, ctx, mailboxId));
  const folders = await listSyncFolders(deps.db, ctx, mailboxId, { enabledOnly: true });
  const provider = await openImapProvider(imap);
  const found = new Map<string, MessageMeta[] | null>();
  try {
    for (const folder of folders) {
      try {
        await provider.folderStatus(folder.path);
        found.set(folder.key, await fetchSince(provider, folder.path, since));
      } catch (error) {
        if (!(error instanceof MailFolderMissingError)) throw error;
        found.set(folder.key, null);
      }
    }
  } finally {
    await provider.close();
  }
  const results: { key: SyncFolderKey; counts: AuditCounts | null }[] = [];
  for (const folder of folders) {
    const metas = found.get(folder.key) ?? null;
    if (metas === null) {
      results.push({ key: folder.key, counts: null });
      continue;
    }
    const others = folders.filter((other) => other.key !== folder.key).map((other) => other.path);
    const here = await listFolderEmailKeys(deps.db, ctx, mailboxId, [folder.path], since);
    const elsewhere = await listFolderEmailKeys(deps.db, ctx, mailboxId, others, since);
    const toKey = (row: { message_id_header: string | null; content_hash: string }) => ({
      messageId: row.message_id_header,
      hash: row.content_hash,
    });
    results.push({
      key: folder.key,
      counts: compareFolderWithDb(
        metas.map((meta) => ({ messageId: normalizeMessageId(meta.messageId), hash: contentHash(meta) })),
        here.map(toKey),
        elsewhere.map(toKey)
      ),
    });
  }
  return results;
}

export const SIGNALS_CONTENT_LIMIT = 200;

const SIGNALS_MAX_NAMES = 10;
const SERVER_NAME = /^[a-z0-9.-]{1,64}$/;

export interface MailboxSignals {
  mails: number; // INBOX mail with INTERNALDATE in the window
  answered: number;
  seen: number;
  flagged: number;
  contentRead: number; // the newest mails whose content was read (<= SIGNALS_CONTENT_LIMIT)
  captureFailed: number; // contentRead mails with capture null
  authResults: number; // of contentRead: capture.authResults not null
  authservIds: Record<string, number>; // server name -> count, at most 10 names, the rest under "other"
  listUnsubscribe: number;
  partsUnknown: number; // over the size limit
}

/** The server name of an Authentication-Results value (RFC 8601 §2.2), or "other" when it is not a plain host name. */
export function authservIdOf(authResults: string): string {
  const name = (authResults.split(";")[0] ?? "").trim().toLowerCase();
  return SERVER_NAME.test(name) ? name : "other";
}

/** Read-only: counts the IMAP flags and captured headers of INBOX mail since `since`. Counts and server names only. */
export async function signalsOfMailbox(
  deps: ToolDeps & { openProvider?: (opts: ImapConnectOptions) => Promise<MailProvider> },
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<MailboxSignals> {
  const imap = await loadImapOptions(deps, ctx, mailboxId, await getMailboxOrThrow(deps, ctx, mailboxId));
  const provider = await (deps.openProvider ?? openImapProvider)(imap);
  const signals: MailboxSignals = {
    mails: 0,
    answered: 0,
    seen: 0,
    flagged: 0,
    contentRead: 0,
    captureFailed: 0,
    authResults: 0,
    authservIds: {},
    listUnsubscribe: 0,
    partsUnknown: 0,
  };
  const names = new Map<string, number>();
  try {
    const metas = await fetchSince(provider, INBOX, since);
    signals.mails = metas.length;
    const uids = metas.map((meta) => meta.uid);
    const has = (flags: string[], flag: string) => flags.some((value) => value.toLowerCase() === flag);
    for (let i = 0; i < uids.length; i += LOCATE_CHUNK) {
      for (const { flags } of await provider.fetchFlagsIn(INBOX, uids.slice(i, i + LOCATE_CHUNK))) {
        if (has(flags, "\\answered")) signals.answered += 1;
        if (has(flags, "\\seen")) signals.seen += 1;
        if (has(flags, "\\flagged")) signals.flagged += 1;
      }
    }
    for (const uid of [...uids].sort((a, b) => b - a).slice(0, SIGNALS_CONTENT_LIMIT)) {
      const { capture } = await provider.fetchContent(INBOX, uid);
      signals.contentRead += 1;
      if (capture === null) {
        signals.captureFailed += 1;
        continue;
      }
      if (!capture.partsKnown) signals.partsUnknown += 1;
      if (capture.listUnsubscribe !== null) signals.listUnsubscribe += 1;
      if (capture.authResults !== null) {
        signals.authResults += 1;
        const name = authservIdOf(capture.authResults);
        names.set(name, (names.get(name) ?? 0) + 1);
      }
    }
  } finally {
    await provider.close();
  }
  const ranked = [...names]
    .filter(([name]) => name !== "other")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let other = names.get("other") ?? 0;
  for (const [i, [name, count]] of ranked.entries()) {
    if (i < SIGNALS_MAX_NAMES) signals.authservIds[name] = count;
    else other += count;
  }
  if (other > 0) signals.authservIds.other = other;
  return signals;
}

/** One-off, read-only: stores INBOX mail of the last `days` days that the regular sync missed (`backfilled_at`). */
export async function backfillMailbox(
  deps: ToolDeps & {
    openProvider?: (opts: ImapConnectOptions) => Promise<MailProvider>;
    isOwnActionId: SyncDeps["isOwnActionId"];
  },
  ctx: TenantContext,
  mailboxId: string,
  opts: { days: number; now: Date }
): Promise<SyncResult> {
  const imap = await loadImapOptions(deps, ctx, mailboxId, await getMailboxOrThrow(deps, ctx, mailboxId));
  const provider = await (deps.openProvider ?? openImapProvider)(imap);
  try {
    return await backfillInbox(
      { db: deps.db, provider, isOwnActionId: deps.isOwnActionId, now: () => opts.now },
      ctx,
      mailboxId,
      { since: new Date(opts.now.getTime() - opts.days * 24 * 3_600_000) }
    );
  } finally {
    await provider.close();
  }
}

export interface DeliverDeps extends ToolDeps {
  openProvider?: (imap: ImapConnectOptions) => Promise<MailProvider>;
}

export interface DeliverInput {
  testAddress: string | undefined;
  sender: string;
  wanted: { caseId: string; messageId: string; sentAt: Date }[]; // 1..200
  checkOnly: boolean; // plan and report, no move and no delete
}

const MAX_WANTED = 200;
const DAY_MS = 86_400_000;

async function findCopies(
  provider: MailProvider,
  folders: { key: FoundCopy["folder"]; path: string }[],
  since: Date
): Promise<FoundCopy[]> {
  const found: FoundCopy[] = [];
  for (const { key, path } of folders) {
    const uids = await provider.searchSinceIn(path, since);
    if (uids.length === 0) continue;
    for (let i = 0; i < uids.length; i += LOCATE_CHUNK) {
      for (const meta of await provider.fetchByUidsIn(path, uids.slice(i, i + LOCATE_CHUNK))) {
        found.push({ folder: key, uid: meta.uid, messageId: meta.messageId, from: meta.from });
      }
    }
  }
  return found;
}

/**
 * Moves the mails of the test tool from the Interia sort folders into INBOX. It refuses, before any connection, unless the mailbox is
 * `testAddress`, and it touches only mails whose Message-ID is wanted and whose From is `sender`.
 */
export async function deliverTestMail(
  deps: DeliverDeps,
  ctx: TenantContext,
  mailboxId: string,
  input: DeliverInput
): Promise<CaseDelivery[]> {
  const mailbox = await getMailboxOrThrow(deps, ctx, mailboxId);
  assertTestAddress(mailbox.address, input.testAddress);
  const sender = input.sender.trim().toLowerCase();
  if (sender === mailbox.address.trim().toLowerCase())
    throw new HardError("the sender is the mailbox itself: deliver refused");
  if (!sender.endsWith("@agentmail.to")) throw new HardError("the sender is not an AgentMail address: deliver refused");
  if (input.wanted.length === 0 || input.wanted.length > MAX_WANTED) {
    throw new HardError(`wanted must hold 1 to ${MAX_WANTED} mails: deliver refused`);
  }
  for (const item of input.wanted) {
    if (Number.isNaN(item.sentAt.getTime())) throw new HardError("a sentAt is not a valid time: deliver refused");
    if (item.messageId.trim() === "") throw new HardError("a messageId is empty: deliver refused");
  }

  const wanted = input.wanted.map(({ caseId, messageId }) => ({ caseId, messageId: messageId.trim() }));
  const rows = await listEmailsByMessageIds(
    deps.db,
    ctx,
    mailboxId,
    wanted.map((item) => item.messageId)
  );
  const syncedMessageIds = new Set(rows.map((row) => row.message_id_header.trim()));
  const since = new Date(Math.min(...input.wanted.map((item) => item.sentAt.getTime())) - DAY_MS);

  const imap = await loadImapOptions(deps, ctx, mailboxId, mailbox);
  const provider = await (deps.openProvider ?? openImapProvider)(imap);
  try {
    const info = await provider.serverInfo();
    const paths: Partial<Record<SortFolderKey, string>> = {};
    for (const key of sortFolderKeys) {
      const path = syncFolderDefaultPath(key);
      if (info.folders.some((folder) => folder.path === path)) paths[key] = path;
    }
    const folders: { key: FoundCopy["folder"]; path: string }[] = [{ key: "inbox", path: INBOX }];
    for (const key of sortFolderKeys) {
      const path = paths[key];
      if (path !== undefined) folders.push({ key, path });
    }

    const found = await findCopies(provider, folders, since);
    const plan = planDelivery({ wanted, sender, syncedMessageIds, found });
    const results = input.checkOnly ? plan : await runPlan(provider, paths, plan);

    const count = (result: CaseDelivery["result"]) => results.filter((item) => item.result === result).length;
    log.info(
      `deliver ${mailboxId}: moved ${count("moved")}, in inbox ${count("in_inbox")}, duplicates removed ${count("duplicate_removed")}, synced ${count("synced")}, not found ${count("not_found")}`
    );
    return results;
  } finally {
    await provider.close();
  }
}

// A failed move skips the deletes of its case: a delete runs only after the INBOX copy exists.
async function runPlan(
  provider: MailProvider,
  paths: Partial<Record<SortFolderKey, string>>,
  plan: CaseDelivery[]
): Promise<CaseDelivery[]> {
  const results: CaseDelivery[] = [];
  for (const delivery of plan) {
    let gone = false;
    for (const op of delivery.ops) {
      const path = paths[op.folder];
      if (path === undefined) throw new HardError("a planned folder is missing");
      try {
        if (op.op === "move") {
          await provider.moveMessage(path, op.uid, INBOX);
        } else if (!(await provider.deleteMessage(path, op.uid))) {
          gone = true;
        }
      } catch (error) {
        if (!(op.op === "move" && error instanceof MailNotFoundError)) throw error;
        gone = true;
      }
      if (gone) break;
    }
    results.push(gone ? { caseId: delivery.caseId, result: "not_found", folder: null, ops: [] } : delivery);
  }
  return results;
}
