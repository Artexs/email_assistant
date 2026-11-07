import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";

import type { ImapConnectOptions } from "./imap/client";
import type { MailProvider } from "./port";
import { getCredentials, getMailbox, type MailboxRow } from "./repo";

export interface OpenDeps {
  db: Db | Transaction<DB>;
  secrets: SecretBox;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
}

// The password lives only in this call frame. The caller closes the provider.
export async function openMailboxProvider(
  deps: OpenDeps,
  ctx: TenantContext,
  mailboxId: string
): Promise<{ provider: MailProvider; mailbox: MailboxRow }> {
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (mailbox === undefined) throw new HardError("mailbox not found");
  const credentials = await getCredentials(deps.db, ctx, mailboxId);
  if (credentials === undefined) throw new HardError("mailbox has no stored password");
  const password = deps.secrets.decrypt(
    { ciphertext: credentials.encrypted_secret, keyVersion: credentials.key_version },
    `mailbox:${mailboxId}`
  );
  const provider = await deps.openProvider({
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    user: mailbox.address,
    password,
  });
  return { provider, mailbox };
}
