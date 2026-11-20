import { configureMailHosts, forceRescan } from "../modules/mail";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";

import { reportFailure } from "./lib/mailbox-failure";
import { cliDescriptions, parseMailboxRescanArgs, type MailboxRescanArgs } from "./mailbox-rescan-args";

async function run(options: MailboxRescanArgs, out: CliRawOutput): Promise<number> {
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
  } finally {
    await db.destroy();
  }
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB. Any later error gets one line and its code.
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseMailboxRescanArgs(argv);
  try {
    return await run(options, out);
  } catch (error) {
    return reportFailure(out, error, "message");
  }
};

if (import.meta.main) {
  await runCli({ prefix: "mailbox-rescan", descriptions: cliDescriptions, main });
}
