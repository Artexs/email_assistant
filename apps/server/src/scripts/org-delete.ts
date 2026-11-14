import { deleteOrganization } from "../modules/privacy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { parseOrgDeleteArgs, usage } from "./org-delete-args";

const log = createLog("org-delete");

// Prints ids and counts. The one exception (F106 D17): after a delete it prints the mailbox addresses, so that the
// operator tells the owner which passwords to change. Never the organization name. Returns the exit code.
async function main(): Promise<number> {
  const args = parseOrgDeleteArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const result = await deleteOrganization(db, { ...args, via: "cli" });
    if (result.kind === "busy") {
      process.stderr.write("busy, try again\n");
      log.error("org_delete_refused", { reason: "busy" });
      return 1;
    }
    if (result.kind !== "deleted") {
      log.error("org_delete_refused", { reason: result.kind });
      return 1;
    }
    process.stdout.write(`deleted ${args.orgId}: mailboxes ${result.mailboxAddresses.length}\n`);
    for (const address of result.mailboxAddresses) {
      process.stdout.write(`change the password of ${address}\n`);
    }
    return 0;
  } catch (error) {
    log.error("org_delete_failed", { ...errorFields(error) });
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("org_delete_failed", { ...errorFields(error) });
    process.exit(1);
  });
