import { cleanSubject, localDateTime, textTables } from "@ea/core";

import { closeDelegation, listDelegations } from "../modules/delegation";
import { getOrganization } from "../modules/tenancy";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import type { Db } from "../platform/db";

import { cliDescriptions, type DelegationsCommand, parseDelegationsArgs } from "./delegations-args";
import { withDb } from "./lib/with-db";

const ACTOR = "cli";

function day(date: Date | null, timeZone: string): string {
  return date === null ? "-" : localDateTime(date, timeZone).date;
}

// Delegations are the user's own data: they go to stdout for the user, not through `log`.
async function run(out: CliRawOutput, command: DelegationsCommand, db: Db): Promise<number> {
  const ctx = { orgId: command.orgId };

  if (command.kind === "list") {
    const org = await getOrganization(db, ctx);
    if (!org) {
      out.raw("not found");
      return 1;
    }
    const rows = await listDelegations(db, ctx, {
      limit: command.limit,
      ...(command.status === undefined ? {} : { status: command.status }),
    });
    if (rows.length === 0) out.raw("no delegations");
    for (const row of rows) {
      out.raw(
        [
          row.id,
          row.status,
          row.delegate_name,
          cleanSubject(row.subject, textTables.en),
          `due ${day(row.due_at, org.timezone)}`,
          `sent ${day(row.sent_at, org.timezone)}`,
          `reminders ${row.reminders_sent}`,
        ].join("\t")
      );
    }
    return 0;
  }

  const result = await db
    .transaction()
    .execute((trx) => closeDelegation(trx, ctx, command.id, { actor: ACTOR, at: new Date() }));
  if (result.kind === "done") out.raw(`done ${command.id}`);
  else if (result.kind === "already") out.raw("already done");
  else if (result.kind === "not_closable") out.raw(`not closable: status ${result.status}`);
  else out.raw("not found");
  return result.kind === "not_found" || result.kind === "not_closable" ? 1 : 0;
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB.
const main: CliSpec["main"] = async (argv, out) => {
  const command = parseDelegationsArgs(argv);
  return withDb(out, (db) => run(out, command, db));
};

if (import.meta.main) {
  await runCli({ prefix: "delegations", descriptions: cliDescriptions, main });
}
