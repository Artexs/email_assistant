import { parseArgs } from "node:util";

import { z } from "zod";

export const usage = "usage: bun run org:delete --org-id <uuid> --confirm <organization name> [--lock-timeout-ms <ms>]";

// A uuid and a non-empty name are required; the lock timeout in milliseconds is optional. null on any bad argument.
export function parseOrgDeleteArgs(
  argv: string[]
): { orgId: string; confirmName: string; lockTimeoutMs?: number } | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        confirm: { type: "string" },
        "lock-timeout-ms": { type: "string" },
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
  const timeout = values["lock-timeout-ms"];
  if (timeout === undefined) return { orgId, confirmName };
  if (!/^[1-9][0-9]{0,8}$/.test(timeout)) return null;
  return { orgId, confirmName, lockTimeoutMs: Number(timeout) };
}
