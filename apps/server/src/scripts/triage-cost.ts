import { DAY_MS } from "@ea/core";

import { listUsageSince } from "../modules/triage";
import { exitCodeOf, runCli, type CliSpec } from "../platform/cli";
import { loadConfig, testMailRule } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";

import { groupUsage, modelReportLines } from "./lib/triage-cost-report";
import { cliDescriptions, parseTriageCostArgs } from "./triage-cost-args";

// The figures are for the user, not log lines: they go to stdout.
const main: CliSpec["main"] = async (argv, cli) => {
  const options = parseTriageCostArgs(argv);

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const now = new Date();
    const since = new Date(now.getTime() - options.days * DAY_MS);
    const rows = await listUsageSince(db, { orgId: options.orgId }, options.mailboxId, since, {
      mail: options.mail,
      testMail: testMailRule(config),
    });

    cli.raw(`triage cost, mailbox ${options.mailboxId}, ${options.mail} mail, last ${options.days} days`);
    const groups = groupUsage(rows);
    if (groups.length === 0) cli.raw("no results with an LLM call");
    for (const group of groups) {
      for (const line of modelReportLines(group, options.days)) cli.raw(line);
    }

    cli.raw("");
    cli.raw("Rows without a model (blocklist, triage_error, llm_blocked) are not counted.");
    return 0;
  } catch (error) {
    const code = exitCodeOf(error);
    cli.fail(`${code === 3 ? "unreachable" : "failed"}: ${describeError(error)}`);
    return code;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "triage-cost", descriptions: cliDescriptions, main });
}
