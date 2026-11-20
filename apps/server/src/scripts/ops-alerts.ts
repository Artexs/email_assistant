import { recentAlerts } from "../modules/operator";
import { createCliOutput } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";

import { alertLine } from "./lib/ops-alerts-lines";
import { alertsUsage, parseOpsAlertsArgs } from "./ops-alerts-args";

const out = createCliOutput("ops-alerts");

async function main(): Promise<number> {
  const args = parseOpsAlertsArgs(process.argv.slice(2));
  if (args === null) {
    out.fail(alertsUsage);
    return 1;
  }
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
  } catch (error) {
    out.fail(`failed: ${describeError(error)}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    out.fail(`failed: ${describeError(error)}`);
    process.exit(1);
  });
