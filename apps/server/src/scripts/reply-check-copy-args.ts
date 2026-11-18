import { parseArgs } from "node:util";

import { z } from "zod";

export const usage = [
  "usage: bun run reply:check-copy --org-id <uuid> --action-id <draft id>",
  "  Read-only probe. Finds the Drafts copy of one draft, hashes it and compares it with the hash that the committer stored.",
  "  Prints one word: same, changed, missing or no_baseline. It never writes to the mailbox or the database.",
  "  Exit 0: it printed a word. Exit 1: usage error, unknown draft id, or failure.",
].join("\n");

export interface CheckCopyOptions {
  orgId: string;
  actionId: string;
}

// Returns undefined on any bad argument; the script prints the usage.
export function readCheckCopyOptions(args: string[]): CheckCopyOptions | undefined {
  try {
    const { values } = parseArgs({
      args,
      options: { "org-id": { type: "string" }, "action-id": { type: "string" } },
      strict: true,
    });
    const orgId = values["org-id"];
    const actionId = values["action-id"];
    if (orgId === undefined || actionId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(actionId).success) return undefined;
    return { orgId, actionId };
  } catch {
    return undefined;
  }
}
