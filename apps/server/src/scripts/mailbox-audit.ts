import { parseArgs } from "node:util";

import { z } from "zod";

import { auditExitCode, auditMailbox, configureMailHosts } from "../modules/mail";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { createLog } from "../platform/log";

const log = createLog("mailbox-audit");

const usage = [
  "usage: bun run mailbox:audit --org-id <uuid> --mailbox-id <uuid> --since <ISO time>",
  "  Read-only. Run it right after a sync: mail from the last sync interval (MAIL_SYNC_EVERY_MIN, default 2 minutes) can show as missing.",
  "  Checks INBOX and every other enabled synced folder. cross = mail that has a row in another synced folder (not lost).",
  "  Exit 0: no difference in INBOX. Exit 2: lost or duplicate INBOX mail. Exit 1: error. cross never changes the code.",
].join("\n");

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        since: { type: "string" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    const sinceText = values.since;
    if (orgId === undefined || mailboxId === undefined || sinceText === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    const since = new Date(sinceText);
    if (Number.isNaN(since.getTime())) return undefined;
    return { orgId, mailboxId, since };
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();

  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const results = await auditMailbox({ db, secrets }, { orgId: options.orgId }, options.mailboxId, options.since);
    for (const { key, counts } of results) {
      if (counts === null) {
        log.info(`folder=${key} not on the server`);
      } else if (key === "inbox") {
        log.info(
          `inbox=${counts.mail} stored=${counts.stored} missing=${counts.missing} duplicates=${counts.duplicates} cross=${counts.cross}`
        );
      } else {
        log.info(
          `folder=${key} mail=${counts.mail} stored=${counts.stored} missing=${counts.missing} duplicates=${counts.duplicates} cross=${counts.cross}`
        );
      }
    }
    return auditExitCode(results.find((result) => result.key === "inbox")?.counts);
  } catch (error) {
    log.error("failed:", error instanceof Error ? error.message : error);
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
