import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "telegram:unlink",
    summary: "Removes the Telegram chat links of one member of an organization.",
    risk: "write",
    needs: ["db"],
    usage: "bun run telegram:unlink --org-id <uuid> --user-id <uuid>",
    exits: {
      3: "the database did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface TelegramUnlinkArgs {
  orgId: string;
  userId: string;
}

const idsSchema = z.object({ orgId: z.uuid(), userId: z.uuid() });

// Throws `UsageError` on any bad argument.
export function parseTelegramUnlinkArgs(argv: string[]): TelegramUnlinkArgs {
  const { values } = parseFlags({
    args: argv,
    options: { "org-id": { type: "string" }, "user-id": { type: "string" } },
  });
  const ids = idsSchema.safeParse({ orgId: values["org-id"], userId: values["user-id"] });
  if (!ids.success) {
    throw new UsageError("--org-id and --user-id are required and must be uuids");
  }
  return ids.data;
}
