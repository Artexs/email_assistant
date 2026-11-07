import { randomUUID } from "node:crypto";

import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";

import { compareInboxWithDb, type AuditCounts } from "./audit";
import { openImapProvider, type ImapConnectOptions } from "./imap/client";
import { appendRaw } from "./imap/tools";
import { INBOX, type MailProvider } from "./port";
import { getCredentials, getMailbox, listInboxEmailKeys, type MailboxRow } from "./repo";
import { renderSeedMessage, SYNTHETIC_MESSAGE_ID_DOMAIN, type SeedMessage } from "./seed";
import { backfillInbox, fetchSince, type SyncDeps, type SyncResult } from "./sync";
import { contentHash, normalizeMessageId } from "./sync-rules";

// Operator tools for the 48-hour run (`mailbox:seed`, `mailbox:audit`).

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
