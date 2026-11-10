import { parseArgs } from "node:util";

import { z } from "zod";

import { auditMailbox } from "../modules/mail";
import { loadConfig } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { createLog } from "../platform/log";

const log = createLog("mailbox-audit");

const usage = [
  "usage: bun run mailbox:audit --org-id <uuid> --mailbox-id <uuid> --since <ISO time>",
  "  Read-only. Run it right after a sync: mail from the last 5 minutes can show as missing.",
  "  Exit 0: no difference. Exit 2: lost or duplicate mail. Exit 1: error.",
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
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const result = await auditMailbox({ db, secrets }, { orgId: options.orgId }, options.mailboxId, options.since);
    log.info(`inbox=${result.inbox} stored=${result.stored} missing=${result.missing} duplicates=${result.duplicates}`);
    return result.missing === 0 && result.duplicates === 0 ? 0 : 2;
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
