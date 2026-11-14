import { parseArgs } from "node:util";

import { z } from "zod";

import type { MailboxSignals } from "../modules/mail";

export const usage = [
  "usage: bun run mailbox:signals --org-id <uuid> --mailbox-id <uuid> [--days 30]",
  "  Read-only. Counts of INBOX mail of the last 1-90 days: IMAP flags, headers of the newest mails, server names.",
  "  Prints counts and mail server names only: no subject, address or UID.",
  "  Exit 0: done. Exit 1: usage error or failure.",
].join("\n");

export interface SignalsOptions {
  orgId: string;
  mailboxId: string;
  days: number;
}

export function readSignalsOptions(args: string[]): SignalsOptions | undefined {
  try {
    const { values } = parseArgs({
      args,
      options: { "org-id": { type: "string" }, "mailbox-id": { type: "string" }, days: { type: "string" } },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || mailboxId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    const days = z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(90))
      .safeParse(values.days ?? "30");
    if (!days.success) return undefined;
    return { orgId, mailboxId, days: days.data };
  } catch {
    return undefined;
  }
}

/** One `key value` line per field; the server names as `authserv <name> <count>` lines. */
export function signalsLines(signals: MailboxSignals): string[] {
  const { authservIds, ...counts } = signals;
  return [
    ...Object.entries(counts).map(([key, value]) => `${key} ${value}`),
    ...Object.entries(authservIds).map(([name, count]) => `authserv ${name} ${count}`),
  ];
}
