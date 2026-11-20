import { EXIT } from "@ea/core";

import { addMember, endMemberSessions, unlinkSso } from "../modules/tenancy";
import { type CliSpec, exitCodeOf, runCli } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb, type Db } from "../platform/db";
import { describeError } from "../platform/errors";

import { cliDescriptions, parseOrgMemberArgs } from "./org-member-args";

const ACTOR = "cli";

export interface OrgMemberDeps {
  db: Db;
  out: (line: string) => void;
  err: (line: string) => void;
  now: () => Date;
}

// Prints ids, counts and result kinds only: never an e-mail address or a name (docs/capabilities/account-data.md rule 17).
// Returns the exit code. A bad argument throws a `UsageError` (`runCli` maps it to exit 2).
export async function runOrgMember(argv: string[], deps: OrgMemberDeps): Promise<number> {
  const command = parseOrgMemberArgs(argv);
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
    return exitCodeOf(error);
  }
}

const main: CliSpec["main"] = async (argv, cli) => {
  // The parse comes first: `--help` and a bad flag need no config. `runOrgMember` parses again.
  parseOrgMemberArgs(argv);
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    return await runOrgMember(argv, {
      db,
      out: (line) => cli.print(line),
      err: (line) => cli.fail(line),
      now: () => new Date(),
    });
  } catch (error) {
    const code = exitCodeOf(error);
    cli.fail(
      code === EXIT.unreachable ? `unreachable: ${describeError(error)}` : `error failed ${describeError(error)}`
    );
    return code;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "org-member", descriptions: cliDescriptions, main });
}
