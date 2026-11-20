import { addDelegate, listDelegates, setDelegateState } from "../modules/delegation";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import type { Db } from "../platform/db";

import { cliDescriptions, type DelegatesCommand, parseDelegatesArgs } from "./delegates-args";
import { withDb } from "./lib/with-db";

const ACTOR = "cli";

// Delegates are the user's own data: they go to stdout for the user, not through `log`.
async function run(out: CliRawOutput, command: DelegatesCommand, db: Db): Promise<number> {
  const ctx = { orgId: command.orgId };
  const now = new Date();

  switch (command.kind) {
    case "add": {
      const result = await addDelegate(db, ctx, {
        name: command.name,
        email: command.email,
        tags: command.tags,
        actor: ACTOR,
        via: "cli",
        now,
      });
      switch (result.kind) {
        case "added":
          out.raw(`added ${result.id}`);
          return 0;
        case "exists":
          out.raw("already there");
          return 0;
        case "mailbox_address":
          out.raw("refused: the address is a mailbox of this organization");
          return 1;
        case "invalid":
          out.raw(`refused: ${result.field}`);
          return 1;
      }
      return 1;
    }
    case "list": {
      const delegates = await listDelegates(db, ctx, { activeOnly: !command.all });
      if (delegates.length === 0) out.raw("no delegates");
      for (const delegate of delegates) {
        out.raw(
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
      out.raw(result === "changed" ? `${command.kind}d ${command.id}` : result === "same" ? "no change" : "not found");
      return result === "not_found" ? 1 : 0;
    }
  }
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB.
const main: CliSpec["main"] = async (argv, out) => {
  const command = parseDelegatesArgs(argv);
  return withDb(out, (db) => run(out, command, db));
};

if (import.meta.main) {
  await runCli({ prefix: "delegates", descriptions: cliDescriptions, main });
}
