import { parseArgs } from "node:util";

import { z } from "zod";

import { connectMailbox, openImapProvider, verifySmtpLogin, type MailCapabilities } from "../modules/mail";
import { loadConfig } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { createLog } from "../platform/log";

const log = createLog("mailbox-connect");

const usage = [
  "usage: read -rs P && printf '%s' \"$P\" | bun run mailbox:connect --org-id <uuid> --address <email>",
  "  [--secret-kind password|app_password (default password)]",
  "  [--imap-host poczta.interia.pl] [--imap-port 993] [--smtp-host poczta.interia.pl] [--smtp-port 465]",
  "The password comes only from stdin, never from an argument.",
].join("\n");

const CAPABILITY_LABELS: [keyof MailCapabilities, string][] = [
  ["idle", "IDLE"],
  ["move", "MOVE"],
  ["uidplus", "UIDPLUS"],
  ["condstore", "CONDSTORE"],
  ["specialUse", "SPECIAL-USE"],
  ["keywords", "KEYWORDS"],
];

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        address: { type: "string" },
        "secret-kind": { type: "string", default: "password" },
        "imap-host": { type: "string", default: "poczta.interia.pl" },
        "imap-port": { type: "string", default: "993" },
        "smtp-host": { type: "string", default: "poczta.interia.pl" },
        "smtp-port": { type: "string", default: "465" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const address = values.address;
    const secretKind = values["secret-kind"];
    if (orgId === undefined || address === undefined) return undefined;
    if (secretKind !== "password" && secretKind !== "app_password") return undefined;
    if (!z.uuid().safeParse(orgId).success) return undefined;
    return {
      orgId,
      address,
      secretKind,
      imapHost: values["imap-host"],
      imapPort: Number(values["imap-port"]),
      smtpHost: values["smtp-host"],
      smtpPort: Number(values["smtp-port"]),
    } as const;
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function main(): Promise<number> {
  const options = readOptions();
  const password = options && (await readPassword());
  if (!options || password === undefined) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const { orgId, ...input } = options;
    const { mailboxId, info } = await connectMailbox(
      { db, secrets, openProvider: openImapProvider, verifySmtp: verifySmtpLogin },
      { orgId },
      { ...input, password }
    );
    log.info(`connected mailbox ${mailboxId}`);
    for (const [key, label] of CAPABILITY_LABELS) {
      log.info(`${label}=${info.capabilities[key] ? "yes" : "no"}`);
    }
    return 0;
  } catch (error) {
    if (isUniqueViolation(error)) {
      log.error("mailbox with this address already exists");
    } else if (error instanceof z.ZodError) {
      log.error(`invalid input: ${error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
      log.error(usage);
    } else {
      log.error("failed:", error instanceof Error ? error.message : error);
    }
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
