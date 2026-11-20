import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import type { MailKind } from "../modules/triage";

export const cliDescriptions = [
  {
    name: "triage:cost",
    summary: "Prints the LLM cost and latency of the triage results of one mailbox, per model.",
    risk: "read",
    needs: ["db"],
    usage: "bun run triage:cost --org-id <uuid> --mailbox-id <uuid> [--days 7] [--mail real|synthetic]",
    exits: { 1: "a failure", 3: "the database did not answer" },
    outputNote: "Counts, tokens, latencies and costs per model; no mail text.",
  },
] satisfies readonly CliDescription[];

export interface TriageCostOptions {
  orgId: string;
  mailboxId: string;
  days: number;
  mail: MailKind;
}

// Throws a `UsageError` (or a `parseArgs` error) on any bad argument: `runCli` prints the usage and exits 2.
export function parseTriageCostArgs(argv: string[]): TriageCostOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "mailbox-id": { type: "string" },
      days: { type: "string", default: "7" },
      mail: { type: "string", default: "real" },
    },
    strict: true,
  });
  const uuid = z.uuid();
  const orgId = values["org-id"];
  const mailboxId = values["mailbox-id"];
  if (orgId === undefined || !uuid.safeParse(orgId).success) throw new UsageError("--org-id is a required uuid");
  if (mailboxId === undefined || !uuid.safeParse(mailboxId).success) {
    throw new UsageError("--mailbox-id is a required uuid");
  }
  const days = z.coerce.number().int().min(1).max(365).safeParse(values.days);
  if (!days.success) throw new UsageError("--days is a whole number from 1 to 365");
  const mail = z.enum(["real", "synthetic"]).safeParse(values.mail);
  if (!mail.success) throw new UsageError("--mail is real or synthetic");
  return { orgId, mailboxId, days: days.data, mail: mail.data };
}
