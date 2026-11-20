import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "web:two-factor-reset",
    summary: "Resets the two-factor sign-in of one organization member and ends their sessions.",
    risk: "danger",
    needs: ["db"],
    usage: "bun run web:two-factor-reset --org-id <uuid> --user-id <uuid> --confirm <organization name>",
    exits: { 1: "organization not found, wrong confirm name, user is not a member, or a failure: nothing was reset" },
  },
] satisfies readonly CliDescription[];

export interface TwoFactorResetArgs {
  orgId: string;
  userId: string;
  confirm: string;
}

// All three options are required; the ids must be uuids. Throws `UsageError` (or a `parseArgs` error) on any bad argument.
export function parseTwoFactorResetArgs(argv: string[]): TwoFactorResetArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "user-id": { type: "string" },
      confirm: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const orgId = values["org-id"];
  const userId = values["user-id"];
  const confirm = values.confirm;
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id <uuid> is required");
  if (userId === undefined || !z.uuid().safeParse(userId).success) throw new UsageError("--user-id <uuid> is required");
  if (confirm === undefined || confirm.trim() === "") {
    throw new UsageError("--confirm <organization name> is required");
  }
  return { orgId, userId, confirm };
}
