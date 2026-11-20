import { parseArgs } from "node:util";

import { type Category, type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "triage:label",
    summary: "Labels triaged mail as right or wrong, one mail by flag or a mailbox one by one.",
    risk: "cost",
    needs: ["db", "llm"],
    usage: [
      "bun run triage:label --org-id <uuid> --mailbox-id <uuid> [--limit 20] [--user-id <uuid>] [--synthetic]",
      "  bun run triage:label --org-id <uuid> --email-id <uuid> (--category <c> | --right | --wrong) [--user-id <uuid>]",
    ].join("\n"),
    exits: { 1: "a failure", 3: "the database did not answer" },
    outputNote:
      "The interactive mode prints the mail (sender, subject, summary) to stdout for the person who labels it.",
  },
] satisfies readonly CliDescription[];

const categoryOption = z.enum(["urgent", "needs_reply", "info", "notification", "spam"]);

export type TriageLabelOptions =
  | { mode: "interactive"; orgId: string; mailboxId: string; limit: number; userId?: string; synthetic: boolean }
  | {
      mode: "single";
      orgId: string;
      emailId: string;
      userId?: string;
      trueCategory?: Category;
      verdict?: "right" | "wrong";
    };

// Throws a `UsageError` (or a `parseArgs` error) on any bad argument: `runCli` prints the usage and exits 2.
export function parseTriageLabelArgs(argv: string[]): TriageLabelOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "mailbox-id": { type: "string" },
      "email-id": { type: "string" },
      "user-id": { type: "string" },
      limit: { type: "string", default: "20" },
      category: { type: "string" },
      right: { type: "boolean", default: false },
      wrong: { type: "boolean", default: false },
      synthetic: { type: "boolean", default: false },
    },
    strict: true,
  });
  const uuid = z.uuid();
  const orgId = values["org-id"];
  const mailboxId = values["mailbox-id"];
  const emailId = values["email-id"];
  const userId = values["user-id"];
  if (orgId === undefined || !uuid.safeParse(orgId).success) throw new UsageError("--org-id is a required uuid");
  if (userId !== undefined && !uuid.safeParse(userId).success) throw new UsageError("--user-id is a uuid");
  const base = userId === undefined ? {} : { userId };

  if (emailId !== undefined) {
    if (mailboxId !== undefined || !uuid.safeParse(emailId).success) {
      throw new UsageError("--email-id is a uuid and excludes --mailbox-id");
    }
    const choices = [values.category !== undefined, values.right, values.wrong].filter(Boolean).length;
    if (choices !== 1) throw new UsageError("give exactly one of --category, --right, --wrong");
    if (values.category !== undefined) {
      const category = categoryOption.safeParse(values.category);
      if (!category.success) throw new UsageError("--category is not a category");
      return { mode: "single", orgId, emailId, trueCategory: category.data, ...base };
    }
    return { mode: "single", orgId, emailId, verdict: values.right ? "right" : "wrong", ...base };
  }

  if (mailboxId === undefined || !uuid.safeParse(mailboxId).success) {
    throw new UsageError("--mailbox-id (or --email-id) is a required uuid");
  }
  if (values.category !== undefined || values.right || values.wrong) {
    throw new UsageError("--category, --right and --wrong need --email-id");
  }
  const limit = z.coerce.number().int().min(1).max(1000).safeParse(values.limit);
  if (!limit.success) throw new UsageError("--limit is a whole number from 1 to 1000");
  return { mode: "interactive", orgId, mailboxId, limit: limit.data, synthetic: values.synthetic, ...base };
}
