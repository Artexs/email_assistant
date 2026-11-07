import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";

import type { ImapConnectOptions } from "./imap/client";
import type { SmtpConnectOptions } from "./imap/smtp";
import type { MailProvider, MailSender } from "./port";
import { getCredentials, getMailbox, type MailboxRow } from "./repo";

export interface OpenDeps {
  db: Db | Transaction<DB>;
  secrets: SecretBox;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
  // S4 (D33): only a caller that asks `withSender` needs it. Without it the sender is null (applySend releases the send).
  openSender?(opts: SmtpConnectOptions): Promise<MailSender>;
}

// The password lives only in this call frame (and in the sender's closure). The caller closes the provider and the sender.
export async function openMailboxProvider(
  deps: OpenDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: { withSender?: boolean } = {}
): Promise<{ provider: MailProvider; sender: MailSender | null; mailbox: MailboxRow }> {
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
  if (opts.withSender !== true || deps.openSender === undefined) return { provider, sender: null, mailbox };
  try {
    const sender = await deps.openSender({
      host: mailbox.smtp_host,
      port: mailbox.smtp_port,
      user: mailbox.address,
      password,
    });
    return { provider, sender, mailbox };
  } catch (error) {
    await provider.close().catch(() => undefined);
    throw error;
  }
}
