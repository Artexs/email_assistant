import { cleanSubject } from "@ea/core";

import { closeDelegation, listDelegations } from "../modules/delegation";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

import { parseDelegationsArgs, usage } from "./delegations-args";

const log = createLog("delegations");

const ACTOR = "cli";

// Delegations are the user's own data: they go to stdout for the user, not through `log`.
function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function day(date: Date | null): string {
  return date === null ? "-" : date.toISOString().slice(0, 10);
}

async function main(): Promise<number> {
  const command = parseDelegationsArgs(process.argv.slice(2));
  if (!command) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const ctx = { orgId: command.orgId };

    if (command.kind === "list") {
      const rows = await listDelegations(db, ctx, {
        limit: command.limit,
        ...(command.status === undefined ? {} : { status: command.status }),
      });
      if (rows.length === 0) out("no delegations");
      for (const row of rows) {
        out(
          [
            row.id,
            row.status,
            row.delegate_name,
            cleanSubject(row.subject),
            `due ${day(row.due_at)}`,
            `sent ${day(row.sent_at)}`,
            `reminders ${row.reminders_sent}`,
          ].join("\t")
        );
      }
      return 0;
    }

    const result = await db
      .transaction()
      .execute((trx) => closeDelegation(trx, ctx, command.id, { actor: ACTOR, at: new Date() }));
    out(result === "done" ? `done ${command.id}` : result === "already" ? "already done" : "not found");
    return result === "not_found" ? 1 : 0;
  } catch (error) {
    log.error("failed:", describeError(error));
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", describeError(error));
    process.exit(1);
  });
