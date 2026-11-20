import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "reply:check-copy",
    summary: "Compares the Drafts copy of one reply draft with the hash that the committer stored.",
    risk: "read",
    needs: ["db", "imap"],
    usage: [
      "bun run reply:check-copy --org-id <uuid> --action-id <draft id>",
      "  Read-only probe. Finds the Drafts copy of one draft, hashes it and compares it with the hash that the committer stored.",
      "  Prints one word: same, changed, missing or no_baseline. It never writes to the mailbox and never changes a draft, a send or any other row.",
      "  Opening an OAuth mailbox can refresh its access token and store the rotated refresh token, as every open of that mailbox does.",
    ].join("\n"),
    exits: { 1: "unknown draft id or a failure", 3: "the database or the mail server did not answer" },
  },
] satisfies readonly CliDescription[];

export interface CheckCopyOptions {
  orgId: string;
  actionId: string;
}

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function readCheckCopyOptions(args: string[]): CheckCopyOptions {
  const { values } = parseFlags({
    args,
    options: { "org-id": { type: "string" }, "action-id": { type: "string" } },
  });
  const orgId = values["org-id"];
  const actionId = values["action-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id <uuid> is required");
  if (actionId === undefined || !z.uuid().safeParse(actionId).success) {
    throw new UsageError("--action-id <uuid> is required");
  }
  return { orgId, actionId };
}
