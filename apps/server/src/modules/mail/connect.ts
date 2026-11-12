import { randomUUID } from "node:crypto";

import { AI_FOLDER_NAMES, smtpSecurities, type SmtpSecurity } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError, SoftError } from "../../platform/errors";
import { auditEvents, recordAudit } from "../audit";
import { insertDefaultSettings } from "../config";
import { getOrgPlan } from "../tenancy";

import type { ImapConnectOptions } from "./imap/client";
import type { SmtpConnectOptions } from "./imap/smtp";
import {
  MailboxExistsError,
  MailboxLimitError,
  MailboxNotFoundError,
  type MailFolder,
  type MailProvider,
  type MailServerInfo,
} from "./port";
import {
  countMailboxesOfOrg,
  findMailboxIdByAddress,
  getCredentials,
  getMailbox,
  insertCredentials,
  insertInboxFolder,
  insertMailbox,
  lockMailbox,
  lockMailboxLimit,
  setMailboxStatus,
  updateCredentials,
  type MailboxStatus,
} from "./repo";

const SPECIAL_USE_KEYS: Record<string, string> = {
  "\\Drafts": "drafts",
  "\\Sent": "sent",
  "\\Trash": "trash",
  "\\Junk": "junk",
};

const port = z.number().int().min(1).max(65535);
const host = z.string().trim().min(1);
// The HTML5 rule: it also accepts a host without a dot, such as the local test server's "localhost".
const connectInputSchema = z.object({
  address: z.email({ pattern: z.regexes.html5Email }),
  password: z.string().min(1),
  secretKind: z.enum(["password", "app_password"]),
  imapHost: host,
  imapPort: port,
  smtpHost: host,
  smtpPort: port,
  smtpSecurity: z.enum(smtpSecurities).default("tls"),
});

export interface ConnectInput {
  address: string;
  password: string;
  secretKind: "password" | "app_password";
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** Defaults to `tls`. `starttls` is for port 587. */
  smtpSecurity?: SmtpSecurity;
}

export interface ConnectDeps {
  db: Db | Transaction<DB>;
  secrets: SecretBox;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
  verifySmtp(opts: SmtpConnectOptions): Promise<void>;
  /** The web sets it: the socket timeout of each login and the deadline of the whole check. The CLI sets none. */
  timeouts?: { socketMs: number; deadlineMs: number };
}

export interface ConnectMeta {
  actor: string;
  via: "web" | "cli";
}

export function buildFolderMap(folders: MailFolder[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const folder of folders) {
    const key = folder.specialUse === null ? undefined : SPECIAL_USE_KEYS[folder.specialUse];
    if (key !== undefined && map[key] === undefined) map[key] = folder.path;
  }
  // S3 creates the AI folders before the first move; connect does not change the mailbox.
  return { ...map, ...AI_FOLDER_NAMES };
}

// Ends a check that hangs: the late result of `promise` is dropped.
async function withDeadline<T>(promise: Promise<T>, ms: number | undefined): Promise<T> {
  if (ms === undefined) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SoftError("mail check timed out")), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function isMailboxAddressViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const fields = error as { code?: unknown; constraint?: unknown };
  return fields.code === "23505" && fields.constraint === "mailboxes_org_address_key";
}

async function readServerInfo(deps: ConnectDeps, opts: ImapConnectOptions): Promise<MailServerInfo> {
  const provider = await deps.openProvider(opts);
  try {
    return await provider.serverInfo();
  } finally {
    await provider.close();
  }
}

// Tests the IMAP and SMTP login first: a login error writes no row. The password is stored only encrypted.
export async function connectMailbox(
  deps: ConnectDeps,
  ctx: TenantContext,
  input: ConnectInput,
  meta: ConnectMeta = { actor: "system", via: "cli" }
): Promise<{ mailboxId: string; info: MailServerInfo }> {
  const valid = connectInputSchema.parse(input);

  // Before any login: a duplicate never opens a connection.
  if ((await findMailboxIdByAddress(deps.db, ctx, valid.address)) !== undefined) throw new MailboxExistsError();

  // Before any login, without a lock: an organization at its limit never opens a connection.
  const plan = await getOrgPlan(deps.db, ctx);
  if (plan === undefined) throw new HardError("organization not found");
  if ((await countMailboxesOfOrg(deps.db, ctx)) >= plan.maxMailboxes) throw new MailboxLimitError(plan.maxMailboxes);

  const { timeouts } = deps;
  const info = await withDeadline(
    readServerInfo(deps, {
      host: valid.imapHost,
      port: valid.imapPort,
      user: valid.address,
      password: valid.password,
      connectionTimeoutMs: timeouts?.socketMs,
    }),
    timeouts?.deadlineMs
  );
  await withDeadline(
    deps.verifySmtp({
      host: valid.smtpHost,
      port: valid.smtpPort,
      security: valid.smtpSecurity,
      user: valid.address,
      password: valid.password,
      timeoutMs: timeouts?.socketMs,
    }),
    timeouts?.deadlineMs
  );

  const mailboxId = randomUUID();
  const secret = deps.secrets.encrypt(valid.password, `mailbox:${mailboxId}`);

  const run = async (trx: Db | Transaction<DB>) => {
    // The lock covers only the check and the inserts, never a login (D6).
    await lockMailboxLimit(trx, ctx);
    const current = await getOrgPlan(trx, ctx);
    if (current === undefined) throw new HardError("organization not found");
    if ((await countMailboxesOfOrg(trx, ctx)) >= current.maxMailboxes)
      throw new MailboxLimitError(current.maxMailboxes);
    await insertMailbox(trx, ctx, {
      id: mailboxId,
      address: valid.address,
      imapHost: valid.imapHost,
      imapPort: valid.imapPort,
      smtpHost: valid.smtpHost,
      smtpPort: valid.smtpPort,
      smtpSecurity: valid.smtpSecurity,
      capabilities: info.capabilities,
      folderMap: buildFolderMap(info.folders),
    });
    await insertInboxFolder(trx, ctx, mailboxId);
    await insertCredentials(trx, ctx, {
      mailboxId,
      encryptedSecret: secret.ciphertext,
      secretKind: valid.secretKind,
      keyVersion: secret.keyVersion,
    });
    await insertDefaultSettings(trx, ctx, mailboxId);
    await recordAudit(trx, ctx, {
      actor: meta.actor,
      event: auditEvents.mailboxConnected,
      data: { mailbox_id: mailboxId, via: meta.via },
    });
  };

  try {
    await (deps.db.isTransaction ? run(deps.db) : deps.db.transaction().execute(run));
  } catch (error) {
    // A concurrent connect of the same address wins the unique index.
    if (isMailboxAddressViolation(error)) throw new MailboxExistsError({ cause: error });
    throw error;
  }
  return { mailboxId, info };
}

// Tests the IMAP and SMTP login with the new password first: a login error stores nothing.
// An `auth_error` mailbox becomes `active`; a `paused` one stays paused.
export async function updateMailboxPassword(
  deps: ConnectDeps,
  ctx: TenantContext,
  input: { mailboxId: string; password: string; secretKind?: "password" | "app_password"; now: Date; actor?: string }
): Promise<{ status: MailboxStatus; reactivated: boolean }> {
  const { mailboxId, password, now } = input;
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (!mailbox) throw new MailboxNotFoundError();

  const { timeouts } = deps;
  await withDeadline(
    (async () => {
      const provider = await deps.openProvider({
        host: mailbox.imap_host,
        port: mailbox.imap_port,
        user: mailbox.address,
        password,
        connectionTimeoutMs: timeouts?.socketMs,
      });
      await provider.close();
    })(),
    timeouts?.deadlineMs
  );
  await withDeadline(
    deps.verifySmtp({
      host: mailbox.smtp_host,
      port: mailbox.smtp_port,
      security: mailbox.smtp_security,
      user: mailbox.address,
      password,
      timeoutMs: timeouts?.socketMs,
    }),
    timeouts?.deadlineMs
  );

  const secret = deps.secrets.encrypt(password, `mailbox:${mailboxId}`);

  const run = async (trx: Transaction<DB>) => {
    const locked = await lockMailbox(trx, ctx, mailboxId);
    if (!locked) throw new MailboxNotFoundError();
    const current = await getCredentials(trx, ctx, mailboxId);
    if (!current) throw new HardError("credentials row missing");
    const stored = await updateCredentials(trx, ctx, mailboxId, {
      encryptedSecret: secret.ciphertext,
      secretKind: input.secretKind ?? (current.secret_kind as "password" | "app_password"),
      keyVersion: secret.keyVersion,
    });
    if (!stored) throw new HardError("credentials row missing");

    const reactivated = locked.status === "auth_error";
    if (reactivated) await setMailboxStatus(trx, ctx, mailboxId, "active", now);
    await recordAudit(trx, ctx, {
      actor: input.actor ?? "system",
      event: auditEvents.mailboxPasswordChanged,
      data: { mailbox_id: mailboxId, reactivated },
      at: now,
    });
    return { status: reactivated ? ("active" as const) : (locked.status as MailboxStatus), reactivated };
  };

  return deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run);
}
