import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "telegram:link",
    summary: "Makes a one-time Telegram link for one member of an organization.",
    risk: "write",
    needs: ["db", "telegram"],
    usage: [
      "bun run telegram:link --org-id <uuid> [--user-id <uuid>]",
      "  Without --user-id the organization must have exactly one member.",
    ].join("\n"),
    outputNote: "prints a one-time link (valid 15 minutes) that gives access to the member's chat link",
    exits: {
      1: "the organization has no or several members, or the bot token is missing or refused",
      3: "the database or the Telegram Bot API did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface TelegramLinkArgs {
  orgId: string;
  userId: string | undefined;
}

const idsSchema = z.object({ orgId: z.uuid(), userId: z.uuid().optional() });

// Throws `UsageError` on any bad argument.
export function parseTelegramLinkArgs(argv: string[]): TelegramLinkArgs {
  const { values } = parseFlags({
    args: argv,
    options: { "org-id": { type: "string" }, "user-id": { type: "string" } },
  });
  const ids = idsSchema.safeParse({ orgId: values["org-id"], userId: values["user-id"] });
  if (!ids.success) {
    throw new UsageError("--org-id is required; --org-id and --user-id must be uuids");
  }
  return { orgId: ids.data.orgId, userId: ids.data.userId };
}
