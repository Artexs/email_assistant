import { SENDER_RULE_LIMIT } from "@ea/core";

import { addSenderRule, listSenderRules } from "../modules/config";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import type { Db } from "../platform/db";

import { withDb } from "./lib/with-db";
import { cliDescriptions, parseRulesArgs, type RulesCommand } from "./rules-args";

// No mailbox has this id: `listSenderRules` then returns the org-wide rules only.
const noMailboxId = "00000000-0000-0000-0000-000000000000";

// The rules are the user's own settings: they go to stdout for the user, not through `log`.
async function run(out: CliRawOutput, command: RulesCommand, db: Db): Promise<number> {
  const ctx = { orgId: command.orgId };

  if (command.command === "add") {
    const result = await addSenderRule(db, ctx, {
      mailboxId: command.mailboxId,
      pattern: command.pattern,
      kind: command.kind,
      actor: "cli",
      now: new Date(),
    });
    if (result.kind === "added") out.raw(`added ${command.kind} ${command.pattern}`);
    if (result.kind === "exists") out.raw(`already there: ${command.kind} ${command.pattern}`);
    if (result.kind === "limit") {
      out.fail(`refused: rule limit reached (${SENDER_RULE_LIMIT})`);
      return 1;
    }
    if (result.kind === "mailbox_not_found") {
      out.fail("refused: mailbox not found");
      return 1;
    }
    return 0;
  }

  out.raw(command.mailboxId ? `scope: org-wide + mailbox ${command.mailboxId}` : "scope: org-wide");
  const rules = await listSenderRules(db, ctx, command.mailboxId ?? noMailboxId);
  if (rules.length === 0) out.raw("no rules");
  for (const rule of rules) out.raw(`${rule.kind}\t${rule.pattern}`);
  return 0;
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB.
const main: CliSpec["main"] = async (argv, out) => {
  const command = parseRulesArgs(argv);
  return withDb(out, (db) => run(out, command, db));
};

if (import.meta.main) {
  await runCli({ prefix: "rules", descriptions: cliDescriptions, main });
}
