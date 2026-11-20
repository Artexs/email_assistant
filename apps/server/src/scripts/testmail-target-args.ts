import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "testmail:target",
    summary: "On the server: finds the test mail of a batch in a mailbox, or compares its triage to the labels.",
    risk: "outside",
    needs: ["db", "imap"],
    usage: [
      "bun run testmail:target deliver --org-id <uuid> --mailbox-id <uuid> [--check-only] < input.json",
      "bun run testmail:target compare --org-id <uuid> --mailbox-id <uuid> [--bar 0.98] [--min-kept 30] < input.json",
      "  input.json: the target input of a batch (bun run testmail:remote … --print-input writes it). deliver refuses every mailbox except TEST_MAILBOX_ADDRESS.",
    ].join("\n"),
    exits: {
      1: "bad input on stdin, nothing sent yet, or a failure",
      4: "some cases are not found or not triaged yet: run it again later",
    },
  },
] satisfies readonly CliDescription[];

export interface TestmailTargetArgs {
  command: "deliver" | "compare";
  orgId: string;
  mailboxId: string;
  checkOnly: boolean;
  bar: number;
  minKept: number;
}

const DEFAULT_BAR = "0.98";
const DEFAULT_MIN_KEPT = "30";

const optionSchema = z.object({
  orgId: z.uuid(),
  mailboxId: z.uuid(),
  checkOnly: z.boolean(),
  bar: z.coerce.number().gt(0).max(1),
  minKept: z.coerce.number().int().min(1),
});

/** `deliver` or `compare` and its options. `--bar` and `--min-kept` are for `compare` only, `--check-only` for `deliver` only. Throws `UsageError` (or a `parseArgs` error) on a bad argument. */
export function parseTestmailTargetArgs(argv: string[]): TestmailTargetArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "mailbox-id": { type: "string" },
      "check-only": { type: "boolean" },
      bar: { type: "string" },
      "min-kept": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const command = positionals.length === 1 ? positionals[0] : undefined;
  if (command !== "deliver" && command !== "compare") throw new UsageError("the first argument is deliver or compare");
  const parsed = optionSchema.safeParse({
    orgId: values["org-id"],
    mailboxId: values["mailbox-id"],
    checkOnly: values["check-only"] === true,
    bar: values.bar ?? DEFAULT_BAR,
    minKept: values["min-kept"] ?? DEFAULT_MIN_KEPT,
  });
  if (!parsed.success) {
    throw new UsageError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "-"}: ${issue.code}`).join("; ")
    );
  }
  if (command === "compare" && parsed.data.checkOnly) throw new UsageError("--check-only is for deliver only");
  if (command === "deliver" && (values.bar !== undefined || values["min-kept"] !== undefined)) {
    throw new UsageError("--bar and --min-kept are for compare only");
  }
  return { command, ...parsed.data };
}
