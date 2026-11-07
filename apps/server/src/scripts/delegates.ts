import { addDelegate, listDelegates, setDelegateState } from "../modules/delegation";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

import { parseDelegatesArgs, usage } from "./delegates-args";

const log = createLog("delegates");

const ACTOR = "cli";

// Delegates are the user's own data: they go to stdout for the user, not through `log`.
function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  const command = parseDelegatesArgs(process.argv.slice(2));
  if (!command) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const ctx = { orgId: command.orgId };
    const now = new Date();

    switch (command.kind) {
      case "add": {
        const result = await addDelegate(db, ctx, {
          name: command.name,
          email: command.email,
          tags: command.tags,
          actor: ACTOR,
          now,
        });
        switch (result.kind) {
          case "added":
            out(`added ${result.id}`);
            return 0;
          case "exists":
            out("already there");
            return 0;
          case "mailbox_address":
            out("refused: the address is a mailbox of this organization");
            return 2;
          case "invalid":
            out(`refused: ${result.field}`);
            return 2;
        }
        return 1;
      }
      case "list": {
        const delegates = await listDelegates(db, ctx, { activeOnly: !command.all });
        if (delegates.length === 0) out("no delegates");
        for (const delegate of delegates) {
          out(
            [
              delegate.id,
              delegate.active ? "on" : "off",
              delegate.name,
              delegate.email,
              delegate.competence_tags.join(","),
            ].join("\t")
          );
        }
        return 0;
      }
      case "disable":
      case "enable": {
        const result = await setDelegateState(db, ctx, {
          id: command.id,
          active: command.kind === "enable",
          actor: ACTOR,
          now,
        });
        out(result === "changed" ? `${command.kind}d ${command.id}` : result === "same" ? "no change" : "not found");
        return result === "not_found" ? 1 : 0;
      }
    }
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
