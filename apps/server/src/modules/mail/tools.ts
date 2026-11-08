import { randomUUID } from "node:crypto";

import {
  planDelivery,
  SORT_FOLDER_NAMES,
  sortFolderKeys,
  type CaseDelivery,
  type FoundCopy,
  type SortFolderKey,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { createLog } from "../../platform/log";

import { compareInboxWithDb, type AuditCounts } from "./audit";
import { openImapProvider, type ImapConnectOptions } from "./imap/client";
import { assertTestAddress } from "./imap/probe-move";
import { appendRaw } from "./imap/tools";
import { LOCATE_CHUNK } from "./locate";
import { INBOX, MailNotFoundError, type MailProvider } from "./port";
import { getCredentials, getMailbox, listEmailsByMessageIds, listInboxEmailKeys, type MailboxRow } from "./repo";
import { renderSeedMessage, SYNTHETIC_MESSAGE_ID_DOMAIN, type SeedMessage } from "./seed";
import { backfillInbox, fetchSince, type SyncDeps, type SyncResult } from "./sync";
import { contentHash, normalizeMessageId } from "./sync-rules";

// Operator tools for the 48-hour run (`mailbox:seed`, `mailbox:audit`, `testmail-target deliver`).

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
 * APPENDs `count` synthetic mails into INBOX (or, with `messages`, each message once; `count` is then ignored). It refuses, before any connection, unless `testAddress`
 * is set and equals the mailbox address (case-insensitive), so it never writes into a real mailbox.
 */
export async function seedMailbox(
  deps: ToolDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: { count: number; testAddress: string | undefined; messages?: SeedMessage[] }
): Promise<number> {
  const mailbox = await getMailboxOrThrow(deps, ctx, mailboxId);
  const address = mailbox.address;
  if (opts.testAddress === undefined) throw new HardError("TEST_MAILBOX_ADDRESS is not set: seed refused");
  if (opts.testAddress.trim().toLowerCase() !== address.toLowerCase()) {
    throw new HardError("the mailbox is not the test mailbox (TEST_MAILBOX_ADDRESS): seed refused");
  }
  const imap = await loadImapOptions(deps, ctx, mailboxId, mailbox);
  if (opts.messages !== undefined) {
    for (const message of opts.messages) await appendRaw(imap, INBOX, renderSeedMessage(message));
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
    await appendRaw(imap, INBOX, raw);
  }
  return opts.count;
}

/** Read-only: compares INBOX mail since `since` with the stored INBOX rows. */
export async function auditMailbox(
  deps: ToolDeps,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<AuditCounts> {
  const imap = await loadImapOptions(deps, ctx, mailboxId, await getMailboxOrThrow(deps, ctx, mailboxId));
  const provider = await openImapProvider(imap);
  let metas;
  try {
    metas = await fetchSince(provider, since);
  } finally {
    await provider.close();
  }
  const rows = await listInboxEmailKeys(deps.db, ctx, mailboxId, since);
  return compareInboxWithDb(
    metas.map((meta) => ({ messageId: normalizeMessageId(meta.messageId), hash: contentHash(meta) })),
    rows.map((row) => ({ messageId: row.message_id_header, hash: row.content_hash }))
  );
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
      if (key === "junk") {
        const junk = info.folders.find((folder) => folder.specialUse === "\\Junk");
        if (junk !== undefined) paths.junk = junk.path;
      } else if (info.folders.some((folder) => folder.path === SORT_FOLDER_NAMES[key])) {
        paths[key] = SORT_FOLDER_NAMES[key];
      }
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
