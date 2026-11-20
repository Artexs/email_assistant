import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import type { MailboxSignals } from "../modules/mail";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "mailbox:signals",
    summary: "Counts the INBOX mail flags, headers and mail server names of the last days.",
    risk: "read",
    needs: ["db", "imap"],
    usage: [
      "bun run mailbox:signals --org-id <uuid> --mailbox-id <uuid> [--days 30]",
      "  Read-only. Counts of INBOX mail of the last 1-90 days: IMAP flags, headers of the newest mails, server names.",
      "  Prints counts and mail server names only: no subject, address or UID.",
    ].join("\n"),
    exits: {
      1: "a failure, or the mail login was refused (the reason code is printed)",
      3: "the database or the mail server did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface SignalsOptions {
  orgId: string;
  mailboxId: string;
  days: number;
}

const argsSchema = z.object({
  orgId: z.uuid(),
  mailboxId: z.uuid(),
  days: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(90)),
});

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseMailboxSignalsArgs(argv: string[]): SignalsOptions {
  const { values } = parseFlags({
    args: argv,
    options: { "org-id": { type: "string" }, "mailbox-id": { type: "string" }, days: { type: "string" } },
  });
  const parsed = argsSchema.safeParse({
    orgId: values["org-id"],
    mailboxId: values["mailbox-id"],
    days: values.days ?? "30",
  });
  if (!parsed.success) {
    throw new UsageError("--org-id and --mailbox-id are required uuids; --days is an integer from 1 to 90");
  }
  return parsed.data;
}

/** One `key value` line per field; the server names as `authserv <name> <count>` lines. */
export function signalsLines(signals: MailboxSignals): string[] {
  const { authservIds, ...counts } = signals;
  return [
    ...Object.entries(counts).map(([key, value]) => `${key} ${value}`),
    ...Object.entries(authservIds).map(([name, count]) => `authserv ${name} ${count}`),
  ];
}
