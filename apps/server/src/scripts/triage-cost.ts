import { parseArgs } from "node:util";

import { DAY_MS } from "@ea/core";
import { z } from "zod";

import { listUsageSince, type MailKind } from "../modules/triage";
import { createCliOutput } from "../platform/cli";
import { loadConfig, testMailRule } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";

import { groupUsage, modelReportLines } from "./lib/triage-cost-report";

const cli = createCliOutput("triage-cost");

const usage = "usage: bun run triage:cost --org-id <uuid> --mailbox-id <uuid> [--days 7] [--mail real|synthetic]";

interface Options {
  orgId: string;
  mailboxId: string;
  days: number;
  mail: MailKind;
}

function readOptions(): Options | undefined {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        days: { type: "string", default: "7" },
        mail: { type: "string", default: "real" },
      },
      strict: true,
    });
    const uuid = z.uuid();
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || !uuid.safeParse(orgId).success) return undefined;
    if (mailboxId === undefined || !uuid.safeParse(mailboxId).success) return undefined;
    const days = z.coerce.number().int().min(1).max(365).safeParse(values.days);
    const mail = z.enum(["real", "synthetic"]).safeParse(values.mail);
    if (!days.success || !mail.success) return undefined;
    return { orgId, mailboxId, days: days.data, mail: mail.data };
  } catch {
    return undefined;
  }
}

// The figures are for the user, not log lines: they go to stdout.
function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    cli.fail(usage);
    return 1;
  }

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

    out(`triage cost, mailbox ${options.mailboxId}, ${options.mail} mail, last ${options.days} days`);
    const groups = groupUsage(rows);
    if (groups.length === 0) out("no results with an LLM call");
    for (const group of groups) {
      for (const line of modelReportLines(group, options.days)) out(line);
    }

    out("");
    out("Rows without a model (blocklist, triage_error, llm_blocked) are not counted.");
    return 0;
  } catch (error) {
    cli.fail(`failed: ${describeError(error)}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    cli.fail(`failed: ${describeError(error)}`);
    process.exit(1);
  });
