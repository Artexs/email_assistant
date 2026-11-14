import { parseArgs } from "node:util";

import { z } from "zod";

export const usage = "usage: bun run org:break-glass --org-id <uuid> [--user-id <uuid> | --clear]";

export type OrgBreakGlassArgs =
  | { mode: "list"; orgId: string }
  | { mode: "set"; orgId: string; userId: string }
  | { mode: "clear"; orgId: string };

// Structure only: the service checks the owner and the second factor. null on any bad argument.
export function parseOrgBreakGlassArgs(argv: string[]): OrgBreakGlassArgs | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        "user-id": { type: "string" },
        clear: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return null;
  }

  const isUuid = (value: string): boolean => z.uuid().safeParse(value).success;
  const orgId = values["org-id"];
  if (orgId === undefined || !isUuid(orgId)) return null;

  const userId = values["user-id"];
  if (values.clear) return userId === undefined ? { mode: "clear", orgId } : null;
  if (userId === undefined) return { mode: "list", orgId };
  return isUuid(userId) ? { mode: "set", orgId, userId } : null;
}
