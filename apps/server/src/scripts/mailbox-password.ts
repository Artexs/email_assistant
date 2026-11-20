import {
  configureMailHosts,
  MailAuthError,
  openImapProvider,
  updateMailboxPassword,
  verifySmtpLogin,
} from "../modules/mail";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import { ConfigError, loadConfig, mailAllowLocal, type Config } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { HardError } from "../platform/errors";

import { reportFailure } from "./lib/mailbox-failure";
import { readStdinSecret } from "./lib/stdin-secret";
import { cliDescriptions, parseMailboxPasswordArgs, type MailboxPasswordArgs } from "./mailbox-password-args";

function readConfig(out: CliRawOutput): Config | undefined {
  try {
    const config = loadConfig();
    configureMailHosts({ allowLocal: mailAllowLocal(config) });
    return config;
  } catch (error) {
    if (error instanceof ConfigError) {
      out.fail(`config error: missing or bad keys: ${error.keys.join(", ")}`);
    } else {
      out.fail("config error");
    }
    return undefined;
  }
}

async function run(options: MailboxPasswordArgs, password: string, out: CliRawOutput): Promise<number> {
  const config = readConfig(out);
  if (config === undefined) return 1;
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const { orgId, mailboxId, secretKind } = options;
    const { status, reactivated } = await updateMailboxPassword(
      { db, secrets, openProvider: openImapProvider, verifySmtp: verifySmtpLogin },
      { orgId },
      { mailboxId, password, secretKind, now: new Date() }
    );
    out.print(`password updated for mailbox ${mailboxId}; status ${status}`);
    if (reactivated) out.print("the next sync runs within the sync interval (MAIL_SYNC_EVERY_MIN, default 2 minutes)");
    if (status === "paused") out.print("the mailbox stays paused: use /resume in Telegram");
    return 0;
  } catch (error) {
    if (error instanceof MailAuthError) {
      out.fail(`${error.message}: the password was not saved`);
    } else if (error instanceof HardError) {
      // `MailboxOAuthError` is one: its message is `oauth mailbox: use Reconnect in the panel`.
      out.fail(error.message);
    } else {
      return reportFailure(out, error, "label");
    }
    return 1;
  } finally {
    await db.destroy();
  }
}

// Parse first: a bad argument is a usage error (exit 2) before stdin, config or DB. A terminal or an empty stdin is a refusal (exit 1).
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseMailboxPasswordArgs(argv);
  const secret = await readStdinSecret();
  if (!secret.ok) {
    out.fail(secret.refusal);
    return 1;
  }
  try {
    return await run(options, secret.secret, out);
  } catch (error) {
    return reportFailure(out, error, "label");
  }
};

if (import.meta.main) {
  await runCli({ prefix: "mailbox-password", descriptions: cliDescriptions, main });
}
