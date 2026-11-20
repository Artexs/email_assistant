import { EXIT, lastFinishedWeek } from "@ea/core";

import { gateEvidenceOf, trustEvidenceOf } from "../composition";
import { listUrgentNoticeTimes } from "../modules/channels";
import { configureMailHosts } from "../modules/mail";
import { weekStats } from "../modules/reports";
import { getOrganization } from "../modules/tenancy";
import { exitCodeOf, runCli, type CliSpec } from "../platform/cli";
import { loadConfig, mailAllowLocal, testMailRule } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError, errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { cliDescriptions, parseStatsWeekArgs, statsLines, statsWeekUsage } from "./stats-week-args";

const log = createLog("stats-week");
const usageLine = `usage: ${statsWeekUsage}`;

// Operator tool: it ignores the `stats_page` flag and writes nothing.
const main: CliSpec["main"] = async (argv, out) => {
  // Parse first: a bad argument exits 2 before any config or DB.
  const options = parseStatsWeekArgs(argv);

  const config = loadConfig();
  // The trust reader comes from `composition`, which reaches mail code: the host policy is set as in every entry point.
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const ctx = { orgId: options.orgId };
    const organization = await getOrganization(db, ctx);
    if (organization === undefined) {
      out.fail("not_found: no such organization");
      out.fail(usageLine);
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
      {
        urgentNotices: listUrgentNoticeTimes,
        testMail: testMailRule(config),
        trustEvidence: trustEvidenceOf(db, () => now, gateEvidenceOf(config, { quiet: true }), testMailRule(config)),
      }
    );
    if (stats === "not_found") {
      out.fail("not_found: no such mailbox");
      out.fail(usageLine);
      return 1;
    }
    // The figures are for the operator, not log lines: one bare `key value …` line each (`raw`, no `[name]` prefix).
    out.raw(statsLines(stats).join("\n"));
    return 0;
  } catch (error) {
    log.error("stats_week_failed", { ...errorFields(error) });
    const code = exitCodeOf(error);
    if (code === EXIT.unreachable) out.fail(`unreachable: ${describeError(error)}`);
    return code;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) await runCli({ prefix: "stats-week", descriptions: cliDescriptions, main });
