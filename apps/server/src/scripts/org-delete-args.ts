import { parseArgs } from "node:util";

import { z } from "zod";

export const usage = "usage: bun run org:delete --org-id <uuid> --confirm <organization name>";

// Both options are required: a uuid and a non-empty name. null on any bad argument.
export function parseOrgDeleteArgs(argv: string[]): { orgId: string; confirmName: string } | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        confirm: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return null;
  }
  const orgId = values["org-id"];
  const confirmName = values.confirm;
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) return null;
  if (confirmName === undefined || confirmName.trim() === "") return null;
  return { orgId, confirmName };
}
