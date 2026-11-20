import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "org:status",
    summary: "Prints the plan, mailbox states, call counts and chats of one or every organization.",
    risk: "read",
    needs: ["db"],
    usage: "bun run org:status [--org-id <uuid>]",
    exits: { 3: "the database did not answer" },
  },
] satisfies readonly CliDescription[];

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on a bad argument.
export function parseOrgStatusArgs(argv: string[]): { orgId?: string } {
  const { values } = parseArgs({ args: argv, options: { "org-id": { type: "string" } }, strict: true });
  const orgId = values["org-id"];
  if (orgId === undefined) return {};
  if (!z.uuid().safeParse(orgId).success) throw new UsageError("--org-id is a uuid");
  return { orgId };
}
