import { dsrIsEmpty, findSubjectData } from "../modules/privacy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { parseOrgDsrArgs, usage } from "./org-dsr-args";

const log = createLog("org-dsr");

// Prints counts, table.column names and sizes, never the address (F106 D17). A find that matches nothing prints a
// warning on stderr and still exits 0: the operator checks the spelling. Returns the exit code.
async function main(): Promise<number> {
  const args = parseOrgDsrArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const result = await findSubjectData(db, {
      orgId: args.orgId,
      address: args.address,
      credentialsKey: config.CREDENTIALS_KEY,
      report: args.report,
    });
    if (result.kind !== "found") {
      log.error("org_dsr_refused", { reason: result.kind });
      return 1;
    }
    const { counts } = result;
    process.stdout.write(`mails ${counts.mails}\n`);
    for (const [key, count] of Object.entries(counts.mentions)) {
      process.stdout.write(`mention ${key} ${count}\n`);
    }
    process.stdout.write(`listed delegates ${counts.listed.delegates}\n`);
    process.stdout.write(`listed sender_rules ${counts.listed.sender_rules}\n`);
    process.stdout.write(`open actions ${counts.open_actions}\n`);
    if (result.reportBytes !== null) process.stdout.write(`report ${result.reportBytes} bytes\n`);
    if (dsrIsEmpty(counts)) process.stderr.write("warning: no match, check the spelling of the address\n");
    return 0;
  } catch (error) {
    log.error("org_dsr_failed", { ...errorFields(error) });
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("org_dsr_failed", { ...errorFields(error) });
    process.exit(1);
  });
