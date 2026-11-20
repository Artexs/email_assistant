import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "mailbox:audit",
    summary: "Compares the mail on the server with the stored rows and finds lost or duplicate mail.",
    risk: "read",
    needs: ["db", "imap"],
    usage: [
      "bun run mailbox:audit --org-id <uuid> --mailbox-id <uuid> --since <ISO time>",
      "  Read-only. Run it right after a sync: mail from the last sync interval (MAIL_SYNC_EVERY_MIN, default 2 minutes) can show as missing.",
      "  Checks INBOX and every other enabled synced folder. cross = mail that has a row in another synced folder (not lost).",
      "  Exit 0: no difference in INBOX. Exit 1: lost or duplicate INBOX mail, or a failure. cross never changes the code.",
    ].join("\n"),
    exits: {
      1: "lost or duplicate mail found",
      3: "the database or the mail server did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface MailboxAuditArgs {
  orgId: string;
  mailboxId: string;
  since: Date;
}

const idsSchema = z.object({ orgId: z.uuid(), mailboxId: z.uuid() });

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseMailboxAuditArgs(argv: string[]): MailboxAuditArgs {
  const { values } = parseFlags({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "mailbox-id": { type: "string" },
      since: { type: "string" },
    },
  });
  const ids = idsSchema.safeParse({ orgId: values["org-id"], mailboxId: values["mailbox-id"] });
  if (!ids.success) {
    throw new UsageError("--org-id and --mailbox-id are required and must be uuids");
  }
  const sinceText = values.since;
  if (sinceText === undefined) {
    throw new UsageError("--since is required");
  }
  const since = new Date(sinceText);
  if (Number.isNaN(since.getTime())) {
    throw new UsageError("--since must be an ISO time");
  }
  return { ...ids.data, since };
}
