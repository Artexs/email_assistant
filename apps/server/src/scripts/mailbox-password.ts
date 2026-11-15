import { parseArgs } from "node:util";

import { z } from "zod";

import {
  configureMailHosts,
  MailAuthError,
  MailboxOAuthError,
  openImapProvider,
  updateMailboxPassword,
  verifySmtpLogin,
} from "../modules/mail";
import { createCliOutput } from "../platform/cli";
import { ConfigError, loadConfig, mailAllowLocal, type Config } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { describeError, HardError } from "../platform/errors";

const out = createCliOutput("mailbox-password");

const usage = [
  "usage: read -rsp 'New password: ' P && printf '%s' \"$P\" | bun run mailbox:password --org-id <uuid> --mailbox-id <uuid>",
  "  [--secret-kind password|app_password (default: keep the stored kind)]",
  "The password comes only from stdin, never from an argument.",
].join("\n");

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        "secret-kind": { type: "string" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    const secretKind = values["secret-kind"];
    if (orgId === undefined || mailboxId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    if (secretKind !== undefined && secretKind !== "password" && secretKind !== "app_password") return undefined;
    return { orgId, mailboxId, secretKind } as const;
  } catch {
    return undefined;
  }
}

// A terminal would show the typed password, so stdin must be a pipe.
async function readPassword(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const text = await Bun.stdin.text();
  const password = text.replace(/\r?\n$/, "");
  return password === "" ? undefined : password;
}

function readConfig(): Config | undefined {
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

async function main(): Promise<number> {
  const options = readOptions();
  const password = options && (await readPassword());
  if (!options || password === undefined) {
    out.fail(usage);
    return 1;
  }

  const config = readConfig();
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
    } else if (error instanceof MailboxOAuthError) {
      out.fail("oauth mailbox: use Reconnect in the panel");
    } else if (error instanceof HardError) {
      out.fail(error.message);
    } else {
      out.fail(`failed: ${describeError(error)}`);
    }
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    out.fail(`failed: ${describeError(error)}`);
    process.exit(1);
  });
