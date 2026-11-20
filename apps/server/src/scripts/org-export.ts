import { exportOrganization } from "../modules/privacy";
import { runCli, type CliSpec } from "../platform/cli";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { withDangerDb } from "./lib/danger-run";
import { cliDescriptions, parseOrgExportArgs } from "./org-export-args";

const log = createLog("org-export");
const failed = (error: unknown): void => log.error("org_export_failed", { ...errorFields(error) });

// Prints the organization id, the size and one count per table, never an address, a name or mail text.
// It changes nothing in the database: it needs no confirm.
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseOrgExportArgs(argv);
  return withDangerDb(failed, out, async (db, config) => {
    const result = await exportOrganization(db, { ...args, credentialsKey: config.CREDENTIALS_KEY, now: new Date() });
    if (result.kind !== "written") {
      log.error("org_export_refused", { reason: result.kind });
      return 1;
    }
    out.write(`exported ${args.orgId}: ${result.bytes} bytes\n`);
    for (const [table, count] of Object.entries(result.rows)) {
      out.write(`${table} ${count}\n`);
    }
    return 0;
  });
};

if (import.meta.main) {
  await runCli({ prefix: "org-export", descriptions: cliDescriptions, main });
}
