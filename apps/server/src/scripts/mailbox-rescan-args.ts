import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "mailbox:rescan",
    summary: "Forces the next sync to rescan every synced folder of one mailbox.",
    risk: "write",
    needs: ["db"],
    usage: "bun run mailbox:rescan --org-id <uuid> --mailbox-id <uuid>",
    exits: { 1: "no mailbox changed or the run failed", 3: "the database did not answer" },
  },
] satisfies readonly CliDescription[];

export interface MailboxRescanArgs {
  orgId: string;
  mailboxId: string;
}

const idsSchema = z.object({ orgId: z.uuid(), mailboxId: z.uuid() });

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseMailboxRescanArgs(argv: string[]): MailboxRescanArgs {
  const { values } = parseFlags({
    args: argv,
    options: { "org-id": { type: "string" }, "mailbox-id": { type: "string" } },
  });
  const ids = idsSchema.safeParse({ orgId: values["org-id"], mailboxId: values["mailbox-id"] });
  if (!ids.success) {
    throw new UsageError("--org-id and --mailbox-id are required and must be uuids");
  }
  return ids.data;
}
