import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "org:flag",
    summary: "Lists the feature flags of an organization, or turns one on or off.",
    risk: "write",
    needs: ["db"],
    usage: "bun run org:flag --org-id <uuid> [--flag <key> --on|--off]",
  },
] satisfies readonly CliDescription[];

export type OrgFlagArgs =
  | { mode: "list"; orgId: string }
  | { mode: "set"; orgId: string; flag: string; enabled: boolean };

// Structure only: `setOrgFeature` checks the key (unknown_flag). Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseOrgFlagArgs(argv: string[]): OrgFlagArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      flag: { type: "string" },
      on: { type: "boolean" },
      off: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });

  const orgId = values["org-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id is a uuid");
  if (values.on && values.off) throw new UsageError("--on and --off exclude each other");

  const direction = values.on || values.off;
  if (values.flag === undefined) {
    if (direction) throw new UsageError("--on and --off need --flag");
    return { mode: "list", orgId };
  }
  if (values.flag === "") throw new UsageError("--flag is a key");
  if (!direction) throw new UsageError("--flag needs --on or --off");
  return { mode: "set", orgId, flag: values.flag, enabled: values.on === true };
}
