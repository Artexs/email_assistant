import { parseArgs } from "node:util";

import { z } from "zod";

export const usage = "usage: bun run org:flag --org-id <uuid> [--flag <key> --on|--off]";

export type OrgFlagArgs =
  | { mode: "list"; orgId: string }
  | { mode: "set"; orgId: string; flag: string; enabled: boolean };

// Structure only: `setOrgFeature` checks the key (unknown_flag). null on any bad argument.
export function parseOrgFlagArgs(argv: string[]): OrgFlagArgs | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        flag: { type: "string" },
        on: { type: "boolean" },
        off: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return null;
  }

  const orgId = values["org-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) return null;
  if (values.on && values.off) return null;

  const direction = values.on || values.off;
  if (values.flag === undefined) return direction ? null : { mode: "list", orgId };
  if (values.flag === "" || !direction) return null;
  return { mode: "set", orgId, flag: values.flag, enabled: values.on === true };
}
