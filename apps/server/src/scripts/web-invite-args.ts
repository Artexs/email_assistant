import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "web:invite",
    summary: "Makes a new 24-hour setup link for a member and mails it or prints it.",
    risk: "write",
    needs: ["db", "smtp"],
    usage: "bun run web:invite --org-id <uuid> [--user-id <uuid>] [--print]",
    exits: { 1: "the web is off, the member is missing or the mail failed" },
    outputNote: "prints the setup link with `--print`",
  },
] satisfies readonly CliDescription[];

export interface WebInviteArgs {
  orgId: string;
  userId: string | undefined;
  print: boolean;
}

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on a bad argument.
export function parseWebInviteArgs(argv: string[]): WebInviteArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "user-id": { type: "string" },
      print: { type: "boolean", default: false },
    },
    strict: true,
  });
  const orgId = values["org-id"];
  const userId = values["user-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id is a uuid");
  if (userId !== undefined && !z.uuid().safeParse(userId).success) throw new UsageError("--user-id is a uuid");
  return { orgId, userId, print: values.print };
}
