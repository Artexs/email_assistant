import { parseArgs } from "node:util";

import { z } from "zod";

export const usage = "usage: bun run web:two-factor-reset --org-id <uuid> --user-id <uuid>";

// Both options are required and must be uuids. null on any bad argument.
export function parseTwoFactorResetArgs(argv: string[]): { orgId: string; userId: string } | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        "user-id": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return null;
  }
  const orgId = values["org-id"];
  const userId = values["user-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) return null;
  if (userId === undefined || !z.uuid().safeParse(userId).success) return null;
  return { orgId, userId };
}
