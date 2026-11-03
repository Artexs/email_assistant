import { randomUUID } from "node:crypto";

import type { Transaction } from "kysely";
import { z } from "zod";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { insertDefaultSettings } from "../config";

import type { ImapConnectOptions } from "./imap/client";
import type { SmtpConnectOptions } from "./imap/smtp";
import type { MailFolder, MailProvider, MailServerInfo } from "./port";
import { insertCredentials, insertMailbox } from "./repo";

const SPECIAL_USE_KEYS: Record<string, string> = {
  "\\Drafts": "drafts",
  "\\Sent": "sent",
  "\\Trash": "trash",
  "\\Junk": "junk",
};
// S3 creates these folders before the first move; connect does not change the mailbox.
const AI_FOLDERS = {
  ai_spam: "AI/Spam",
  ai_info: "AI/Info",
  ai_notifications: "AI/Notifications",
  ai_manual: "AI/Manual",
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
});

export interface ConnectInput {
  address: string;
  password: string;
  secretKind: "password" | "app_password";
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export interface ConnectDeps {
  db: Db | Transaction<DB>;
  secrets: SecretBox;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
  verifySmtp(opts: SmtpConnectOptions): Promise<void>;
}

export function buildFolderMap(folders: MailFolder[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const folder of folders) {
    const key = folder.specialUse === null ? undefined : SPECIAL_USE_KEYS[folder.specialUse];
    if (key !== undefined && map[key] === undefined) map[key] = folder.path;
  }
  return { ...map, ...AI_FOLDERS };
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
  input: ConnectInput
): Promise<{ mailboxId: string; info: MailServerInfo }> {
  const valid = connectInputSchema.parse(input);

  const info = await readServerInfo(deps, {
    host: valid.imapHost,
    port: valid.imapPort,
    user: valid.address,
    password: valid.password,
  });
  await deps.verifySmtp({
    host: valid.smtpHost,
    port: valid.smtpPort,
    user: valid.address,
    password: valid.password,
  });

  const mailboxId = randomUUID();
  const secret = deps.secrets.encrypt(valid.password, `mailbox:${mailboxId}`);

  const run = async (trx: Db | Transaction<DB>) => {
    await insertMailbox(trx, ctx, {
      id: mailboxId,
      address: valid.address,
      imapHost: valid.imapHost,
      imapPort: valid.imapPort,
      smtpHost: valid.smtpHost,
      smtpPort: valid.smtpPort,
      capabilities: info.capabilities,
      folderMap: buildFolderMap(info.folders),
    });
    await insertCredentials(trx, ctx, {
      mailboxId,
      encryptedSecret: secret.ciphertext,
      secretKind: valid.secretKind,
      keyVersion: secret.keyVersion,
    });
    await insertDefaultSettings(trx, ctx, mailboxId);
  };

  await (deps.db.isTransaction ? run(deps.db) : deps.db.transaction().execute(run));
  return { mailboxId, info };
}
