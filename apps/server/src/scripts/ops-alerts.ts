import { recentAlerts } from "../modules/operator";
import { runCli, type CliSpec } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";

import { alertLine } from "./lib/ops-alerts-lines";
import { cliDescriptions, parseOpsAlertsArgs } from "./ops-alerts-args";

// Prints kinds, times, counts and facts only. An uncaught error (also an unreachable database) is mapped by `runCli`.
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseOpsAlertsArgs(argv);
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const rows = await recentAlerts(db, { days: args.days, now: new Date() });
    if (rows.length === 0) {
      out.print(`no alerts in the last ${args.days} days`);
      return 0;
    }
    for (const row of rows) out.print(alertLine(row));
    return 0;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "ops-alerts", descriptions: cliDescriptions, main });
}
