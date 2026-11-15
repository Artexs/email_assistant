import { addMember, endMemberSessions, unlinkSso } from "../modules/tenancy";
import { createCliOutput } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb, type Db } from "../platform/db";
import { describeError } from "../platform/errors";

import { parseOrgMemberArgs, usage } from "./org-member-args";

const ACTOR = "cli";

export interface OrgMemberDeps {
  db: Db;
  out: (line: string) => void;
  err: (line: string) => void;
  now: () => Date;
}

// Prints ids, counts and result kinds only: never an e-mail address or a name (docs/capabilities/account-data.md rule 17).
// Returns the exit code.
export async function runOrgMember(argv: string[], deps: OrgMemberDeps): Promise<number> {
  const command = parseOrgMemberArgs(argv);
  if (!command) {
    deps.err(usage);
    return 1;
  }
  const ctx = { orgId: command.orgId };

  try {
    switch (command.kind) {
      case "add": {
        const result = await addMember(deps.db, ctx, {
          email: command.email,
          displayName: command.displayName,
          role: command.role,
          locale: command.locale,
          actor: ACTOR,
          now: deps.now(),
        });
        if (result.kind !== "added") {
          deps.err(`error ${result.kind}`);
          return 1;
        }
        deps.out(`added ${result.userId}`);
        return 0;
      }
      case "end_sessions": {
        const result = await endMemberSessions(deps.db, ctx, {
          userId: command.userId,
          onlySso: command.onlySso,
          actor: ACTOR,
          now: deps.now(),
        });
        if (result.kind === "not_member") {
          deps.err("error not_member");
          return 1;
        }
        deps.out(`ended ${result.count}`);
        return 0;
      }
      case "unlink_sso": {
        const result = await unlinkSso(deps.db, ctx, { userId: command.userId, actor: ACTOR, now: deps.now() });
        if (result.kind === "not_member") {
          deps.err("error not_member");
          return 1;
        }
        deps.out(result.kind === "none" ? "none" : `unlinked, sessions ${result.sessionsEnded}`);
        return 0;
      }
    }
  } catch (error) {
    // The name and the code only: a Postgres error message can hold the address.
    deps.err(`error failed ${describeError(error)}`);
    return 1;
  }
}

async function main(): Promise<number> {
  const cli = createCliOutput("org-member");
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    return await runOrgMember(process.argv.slice(2), {
      db,
      out: (line) => cli.print(line),
      err: (line) => cli.fail(line),
      now: () => new Date(),
    });
  } catch (error) {
    cli.fail(`error failed ${describeError(error)}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

if (import.meta.main) {
  process.exit(await main());
}
