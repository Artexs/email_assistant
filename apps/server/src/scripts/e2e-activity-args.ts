import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "e2e:activity",
    summary: "Adds the activity rows and sender profiles of the activity spec to one e2e mailbox.",
    risk: "dev",
    needs: ["db"],
    usage: [
      "bun run e2e:activity --mailbox-id <uuid>",
      "  Only an e2e database (the name ends in _e2e): any other database is refused with exit 1.",
      "  Needs DATABASE_URL and MIGRATOR_DATABASE_URL.",
    ].join("\n"),
    exits: { 1: "failed, or refused: the database is not an e2e database, or the mailbox is not found" },
  },
] satisfies readonly CliDescription[];

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseE2eActivityArgs(argv: string[]): { mailboxId: string } {
  const { values } = parseArgs({
    args: argv,
    options: { "mailbox-id": { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  const mailboxId = values["mailbox-id"];
  if (mailboxId === undefined || !z.uuid().safeParse(mailboxId).success) throw new UsageError("--mailbox-id is a uuid");
  return { mailboxId };
}
