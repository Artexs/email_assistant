import { format, parseArgs } from "node:util";

import { z } from "zod";

import { configureMailHosts, forceRescan } from "../modules/mail";
import { createCliOutput } from "../platform/cli";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";

const out = createCliOutput("mailbox-rescan");

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
    out.fail(usage);
    return 1;
  }

  const config = loadConfig();

  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    if (!(await forceRescan(db, { orgId: options.orgId }, options.mailboxId))) {
      out.fail("no mailbox changed: unknown mailbox, or it was never synced");
      return 1;
    }
    out.print("rescan forced for every synced folder");
    return 0;
  } catch (error) {
    out.fail(`failed: ${error instanceof Error ? error.message : format(error)}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    out.fail(`failed: ${error instanceof Error ? error.message : format(error)}`);
    process.exit(1);
  });
