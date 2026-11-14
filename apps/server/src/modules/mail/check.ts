import { randomUUID } from "node:crypto";

import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";

import { checkMailboxHosts, type HostCheck } from "./host-status";
import { openImapProvider, type ImapConnectOptions } from "./imap/client";
import { probeHeaderSearch, probeSentAutosave, withCleanupNotes } from "./imap/probe";
import type { SmtpConnectOptions } from "./imap/smtp";
import type { MailCapabilities, MailFolder } from "./port";
import { getCredentials, getMailbox, mailboxStatusSchema, type MailboxStatus } from "./repo";

export interface CheckReport {
  capabilities: MailCapabilities;
  folders: MailFolder[];
  searchHeader: "yes" | "no" | "skipped";
  sentAutosave: "yes" | "no" | "skipped";
  notes: string[];
}

export interface CheckDeps {
  db: Db | Transaction<DB>;
  secrets: SecretBox;
}

/** `sentTimeoutMs` and `pollMs` let tests wait less than the 60 s default of the Sent probe. */
export interface CheckOptions {
  probe: boolean;
  sentTimeoutMs?: number;
  pollMs?: number;
}

export interface MailboxInspection {
  status: MailboxStatus;
  statusChangedAt: Date;
  hosts: { imap: HostCheck; smtp: HostCheck };
  /** Null: a host is not "allowed", and the check made no connection. */
  report: CheckReport | null;
}

function folderWith(folders: MailFolder[], specialUse: string): MailFolder | undefined {
  return folders.find((folder) => folder.specialUse === specialUse);
}

// Without `probe` the check only reads. With `probe` it adds one draft and sends one mail to the mailbox itself.
export async function checkMailbox(
  deps: CheckDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: CheckOptions
): Promise<CheckReport> {
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (mailbox === undefined) throw new HardError("mailbox not found");
  const credentials = await getCredentials(deps.db, ctx, mailboxId);
  if (credentials === undefined) throw new HardError("mailbox has no stored password");
  const password = deps.secrets.decrypt(
    { ciphertext: credentials.encrypted_secret, keyVersion: credentials.key_version },
    `mailbox:${mailboxId}`
  );
  const imap: ImapConnectOptions = {
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    user: mailbox.address,
    password,
  };
  const smtp: SmtpConnectOptions = {
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    security: mailbox.smtp_security,
    user: mailbox.address,
    password,
  };

  const provider = await openImapProvider(imap);
  const info = await provider.serverInfo().finally(() => provider.close());
  const report: CheckReport = {
    capabilities: info.capabilities,
    folders: info.folders,
    searchHeader: "skipped",
    sentAutosave: "skipped",
    notes: [],
  };
  if (!opts.probe) return report;

  let searchByHeader = false;
  // Notes on probes left in the mailbox: a later probe error must not lose them.
  const leftovers: string[] = [];
  const drafts = folderWith(info.folders, "\\Drafts");
  if (drafts === undefined) {
    report.notes.push("no \\Drafts folder: the SEARCH HEADER probe is skipped");
  } else {
    const probeId = randomUUID();
    const result = await probeHeaderSearch(imap, drafts.path, { uidplus: info.capabilities.uidplus, probeId });
    report.searchHeader = result.found ? "yes" : "no";
    searchByHeader = result.found;
    if (!result.deleted) leftovers.push(`delete the probe draft "EA probe ${probeId}" by hand`);
    report.notes.push(...leftovers);
  }

  const sent = folderWith(info.folders, "\\Sent");
  if (sent === undefined) {
    report.notes.push("no \\Sent folder: the SMTP sent-mail probe is skipped");
  } else {
    const probeId = randomUUID();
    const result = await probeSentAutosave(imap, smtp, mailbox.address, sent.path, {
      probeId,
      pollMs: opts.pollMs,
      timeoutMs: opts.sentTimeoutMs,
      searchByHeader,
    }).catch((error: unknown) => {
      throw withCleanupNotes(error, leftovers);
    });
    report.sentAutosave = result.saved ? "yes" : "no";
    report.notes.push(`the probe mail "EA probe ${probeId}" is in INBOX (and Sent if saved); delete it by hand`);
  }
  return report;
}

// Read-only: the status, the host guard on both hosts and, only when both pass, the capability report.
export async function inspectMailbox(
  deps: CheckDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: CheckOptions
): Promise<MailboxInspection> {
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (mailbox === undefined) throw new HardError("mailbox not found");
  const hosts = await checkMailboxHosts(mailbox);
  const report =
    hosts.imap === "allowed" && hosts.smtp === "allowed" ? await checkMailbox(deps, ctx, mailboxId, opts) : null;
  return {
    status: mailboxStatusSchema.parse(mailbox.status),
    statusChangedAt: mailbox.status_changed_at,
    hosts,
    report,
  };
}
