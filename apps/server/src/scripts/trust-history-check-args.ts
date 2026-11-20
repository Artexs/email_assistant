import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "trust:history-check",
    summary: "Queues a history check for one mailbox; the job trust.history runs it.",
    risk: "write",
    needs: ["db"],
    usage: [
      "bun run trust:history-check --org-id <uuid> --mailbox-id <uuid>",
      "  Queues a history check (reason cli) for one mailbox. It reads no mail itself: the job trust.history runs the check.",
      "  Prints the check id and status. A check that is open already is printed, not repeated.",
    ].join("\n"),
    exits: {
      1: "suspended organization (org_suspended), unknown mailbox or a failure",
      3: "the database did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface TrustHistoryCheckArgs {
  orgId: string;
  mailboxId: string;
}

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseTrustHistoryCheckArgs(argv: string[]): TrustHistoryCheckArgs {
  const { values } = parseFlags({
    args: argv,
    options: { "org-id": { type: "string" }, "mailbox-id": { type: "string" } },
  });
  const orgId = values["org-id"];
  const mailboxId = values["mailbox-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id <uuid> is required");
  if (mailboxId === undefined || !z.uuid().safeParse(mailboxId).success) {
    throw new UsageError("--mailbox-id <uuid> is required");
  }
  return { orgId, mailboxId };
}
