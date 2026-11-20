import { type CliDescription, MAX_DIGEST_TIMES, parseDigestTimesInput, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "digest:times",
    summary: "Sets the digest times of one member of an organization, or switches the digests off.",
    risk: "write",
    needs: ["db"],
    usage: [
      "bun run digest:times --org-id <uuid> [--user-id <uuid>] --times <HH:MM,HH:MM | none>",
      "  Without --user-id the organization must have exactly one member. --times none switches the digests off.",
    ].join("\n"),
    exits: {
      1: "no member, several members without --user-id, no membership for the user or a failure",
      3: "the database did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface DigestTimesArgs {
  orgId: string;
  userId: string | undefined;
  times: string[];
}

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseDigestTimesArgs(argv: string[]): DigestTimesArgs {
  const { values } = parseFlags({
    args: argv,
    options: { "org-id": { type: "string" }, "user-id": { type: "string" }, times: { type: "string" } },
  });
  const orgId = values["org-id"];
  const userId = values["user-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id <uuid> is required");
  if (userId !== undefined && !z.uuid().safeParse(userId).success) throw new UsageError("--user-id is not a uuid");
  if (values.times === undefined) throw new UsageError("--times is required");
  const parsed = parseDigestTimesInput(values.times);
  if (!parsed.ok) {
    throw new UsageError(`--times is up to ${MAX_DIGEST_TIMES} times as HH:MM, separated by commas, or none`);
  }
  return { orgId, userId, times: parsed.times };
}
