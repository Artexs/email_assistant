import { lastFinishedWeek } from "@ea/core";

import { listUrgentNoticeTimes } from "../modules/channels";
import { weekStats } from "../modules/reports";
import { getOrganization } from "../modules/tenancy";
import { loadConfig, testMailRule } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { readStatsWeekOptions, statsLines, usage } from "./stats-week-args";

const log = createLog("stats-week");

// Operator tool: it ignores the `stats_page` flag and writes nothing.
async function main(): Promise<number> {
  const options = readStatsWeekOptions(process.argv.slice(2));
  if (!options) {
    process.stderr.write(`${usage}\n`);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const ctx = { orgId: options.orgId };
    const organization = await getOrganization(db, ctx);
    if (organization === undefined) {
      process.stderr.write(`not_found: no such organization\n${usage}\n`);
      return 1;
    }
    const now = new Date();
    const stats = await weekStats(
      db,
      ctx,
      {
        weekStart: options.week ?? lastFinishedWeek(now, organization.timezone),
        mailboxId: options.mailboxId,
        now,
      },
      { urgentNotices: listUrgentNoticeTimes, testMail: testMailRule(config) }
    );
    if (stats === "not_found") {
      process.stderr.write(`not_found: no such mailbox\n${usage}\n`);
      return 1;
    }
    // The figures are for the operator, not log lines.
    process.stdout.write(`${statsLines(stats).join("\n")}\n`);
    return 0;
  } catch (error) {
    log.error("stats_week_failed", { ...errorFields(error) });
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("stats_week_failed", { ...errorFields(error) });
    process.exit(1);
  });
