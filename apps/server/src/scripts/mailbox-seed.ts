import { parseArgs } from "node:util";

import { z } from "zod";

import { seedMailbox } from "../modules/mail";
import { loadConfig } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { createLog } from "../platform/log";

const log = createLog("mailbox-seed");

const usage = [
  "usage: bun run mailbox:seed --org-id <uuid> --mailbox-id <uuid> [--count 1]",
  "  It refuses every mailbox except the one in TEST_MAILBOX_ADDRESS.",
].join("\n");

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        count: { type: "string", default: "1" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || mailboxId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    const count = z.coerce.number().int().min(1).max(1000).safeParse(values.count);
    if (!count.success) return undefined;
    return { orgId, mailboxId, count: count.data };
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
    const appended = await seedMailbox({ db, secrets }, { orgId: options.orgId }, options.mailboxId, {
      count: options.count,
      testAddress: config.TEST_MAILBOX_ADDRESS,
    });
    log.info(`appended ${appended}`);
    return 0;
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
