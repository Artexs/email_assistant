import { parseArgs } from "node:util";

import { z } from "zod";

import { forceRescan } from "../modules/mail";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { createLog } from "../platform/log";

const log = createLog("mailbox-rescan");

const usage = "usage: bun run mailbox:rescan --org-id <uuid> --mailbox-id <uuid>";

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || mailboxId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    return { orgId, mailboxId };
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
    if (!(await forceRescan(db, { orgId: options.orgId }, options.mailboxId))) {
      log.error("no mailbox changed: unknown mailbox, or it was never synced");
      return 1;
    }
    log.info("rescan forced for every synced folder");
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
