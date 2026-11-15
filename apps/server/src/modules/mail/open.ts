import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { createLog } from "../../platform/log";

import type { ImapConnectOptions } from "./imap/client";
import type { SmtpConnectOptions } from "./imap/smtp";
import type { AuthMaterial, MailProvider, MailSender, OAuthTokens } from "./port";
import { getCredentials, getMailbox, type MailboxRow } from "./repo";

const log = createLog("mail");

export interface GraphSenderOptions {
  accessToken: string;
  /** The mailbox address: the sender of every mail. */
  from: string;
  /** A new access token that skips the process cache (after a 401). */
  freshToken(): Promise<string>;
}

export interface OpenDeps {
  db: Db | Transaction<DB>;
  secrets: SecretBox;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
  // S4 (D33): only a caller that asks `withSender` needs it. Without it the sender is null (applySend releases the send).
  openSender?(opts: SmtpConnectOptions): Promise<MailSender>;
  // F117 D5: opens the sender of a mailbox with `send_via = 'graph'`. Without it that mailbox has no sender.
  openGraphSender?(opts: GraphSenderOptions): Promise<MailSender>;
  // F117: the access tokens of `oauth` mailboxes. Without it an `oauth` mailbox does not open.
  oauthTokens?: OAuthTokens;
}

// The password lives only in this call frame (and in the sender's closure). The caller closes the provider and the sender.
// An access token is the same: it comes from `oauthTokens` for each open, and this code never logs it.
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
  const oauth = credentials.secret_kind === "oauth";
  // The table CHECK refuses this row; the code does not rely on it (D5).
  if (mailbox.send_via === "graph" && !oauth) throw new HardError("graph send needs an oauth mailbox");
  let auth: AuthMaterial;
  if (oauth) {
    if (deps.oauthTokens === undefined) throw new HardError("oauth not wired");
    auth = { kind: "oauth", accessToken: await deps.oauthTokens.accessToken(ctx, mailboxId, "mail") };
  } else {
    auth = {
      kind: "password",
      password: deps.secrets.decrypt(
        { ciphertext: credentials.encrypted_secret, keyVersion: credentials.key_version },
        `mailbox:${mailboxId}`
      ),
    };
  }
  const provider = await deps.openProvider({
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    user: mailbox.address,
    auth,
  });
  if (opts.withSender !== true) return { provider, sender: null, mailbox };
  try {
    const sender = await openSenderFor(deps, ctx, mailbox, auth);
    return { provider, sender, mailbox };
  } catch (error) {
    await provider.close().catch(() => undefined);
    throw error;
  }
}

async function openSenderFor(
  deps: OpenDeps,
  ctx: TenantContext,
  mailbox: MailboxRow,
  auth: AuthMaterial
): Promise<MailSender | null> {
  if (mailbox.send_via === "graph") {
    const tokens = deps.oauthTokens;
    if (deps.openGraphSender === undefined || tokens === undefined) {
      log.warn("mailbox_sender_missing", { mailbox_id: mailbox.id, kind: "graph" });
      return null;
    }
    return deps.openGraphSender({
      accessToken: await tokens.accessToken(ctx, mailbox.id, "graph"),
      from: mailbox.address,
      freshToken: () => tokens.accessToken(ctx, mailbox.id, "graph", { fresh: true }),
    });
  }
  if (deps.openSender === undefined) return null;
  return deps.openSender({
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    security: mailbox.smtp_security,
    user: mailbox.address,
    auth,
  });
}
