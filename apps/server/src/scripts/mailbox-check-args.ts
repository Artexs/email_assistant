import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "mailbox:check",
    summary: "Connects to one mailbox and prints its capabilities and folders.",
    risk: "read",
    needs: ["db", "imap"],
    usage: [
      "bun run mailbox:check --org-id <uuid> --mailbox-id <uuid> [--probe]",
      "  --probe adds one draft and sends one mail to the mailbox itself: use it only on a test account.",
    ].join("\n"),
    exits: {
      1: "the host is not allowed or a check failed",
      3: "the database or the mail server did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface MailboxCheckArgs {
  orgId: string;
  mailboxId: string;
  probe: boolean;
}

const idsSchema = z.object({ orgId: z.uuid(), mailboxId: z.uuid() });

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseMailboxCheckArgs(argv: string[]): MailboxCheckArgs {
  const { values } = parseFlags({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "mailbox-id": { type: "string" },
      probe: { type: "boolean", default: false },
    },
  });
  const ids = idsSchema.safeParse({ orgId: values["org-id"], mailboxId: values["mailbox-id"] });
  if (!ids.success) {
    throw new UsageError("--org-id and --mailbox-id are required and must be uuids");
  }
  return { ...ids.data, probe: values.probe === true };
}
