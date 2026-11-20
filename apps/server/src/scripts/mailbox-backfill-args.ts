import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "mailbox:backfill",
    summary: "Stores INBOX mail of the last days that the sync missed, then re-queues the skipped mail.",
    risk: "write",
    needs: ["db", "imap"],
    usage: [
      "bun run mailbox:backfill --org-id <uuid> --mailbox-id <uuid> [--days 30]",
      "  One-off, read-only on the mailbox. Stores INBOX mail of the last 1-180 days that the sync missed.",
      "  Then re-queues stored real mail of that window that the worker skipped as too old.",
      "  Exit 0: done. Exit 1: suspended organization (org_suspended), cursor moved, or failure.",
    ].join("\n"),
    exits: {
      1: "the organization is suspended, the sync moved the cursor (run it again), or a failure",
      3: "the database or the mail server did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface MailboxBackfillArgs {
  orgId: string;
  mailboxId: string;
  days: number;
}

const argsSchema = z.object({
  orgId: z.uuid(),
  mailboxId: z.uuid(),
  days: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(180)),
});

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseMailboxBackfillArgs(argv: string[]): MailboxBackfillArgs {
  const { values } = parseFlags({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "mailbox-id": { type: "string" },
      days: { type: "string" },
    },
  });
  const parsed = argsSchema.safeParse({
    orgId: values["org-id"],
    mailboxId: values["mailbox-id"],
    days: values.days ?? "30",
  });
  if (!parsed.success) {
    throw new UsageError("--org-id and --mailbox-id are required uuids; --days is an integer from 1 to 180");
  }
  return parsed.data;
}
