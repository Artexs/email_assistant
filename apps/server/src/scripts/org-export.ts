import { exportOrganization } from "../modules/privacy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { parseOrgExportArgs, usage } from "./org-export-args";

const log = createLog("org-export");

// Prints the organization id, the size and one count per table, never an address, a name or mail text (F106 D17).
// Returns the exit code.
async function main(): Promise<number> {
  const args = parseOrgExportArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const result = await exportOrganization(db, { ...args, now: new Date() });
    if (result.kind !== "written") {
      log.error("org_export_refused", { reason: result.kind });
      return 1;
    }
    process.stdout.write(`exported ${args.orgId}: ${result.bytes} bytes\n`);
    for (const [table, count] of Object.entries(result.rows)) {
      process.stdout.write(`${table} ${count}\n`);
    }
    return 0;
  } catch (error) {
    log.error("org_export_failed", { ...errorFields(error) });
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("org_export_failed", { ...errorFields(error) });
    process.exit(1);
  });
