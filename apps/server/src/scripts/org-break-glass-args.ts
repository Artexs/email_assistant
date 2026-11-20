import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "org:break-glass",
    summary: "Lists, sets or clears the break-glass owner of an organization.",
    risk: "danger",
    needs: ["db"],
    usage: "bun run org:break-glass --org-id <uuid> [--user-id <uuid> | --clear] [--confirm <organization name>]",
    exits: { 1: "organization not found, wrong confirm name, not an owner, no two-factor sign-in, or a failure" },
    outputNote: "Set and --clear need --confirm <organization name>; the list mode needs none.",
  },
] satisfies readonly CliDescription[];

export type OrgBreakGlassArgs =
  | { mode: "list"; orgId: string }
  | { mode: "set"; orgId: string; userId: string; confirm: string }
  | { mode: "clear"; orgId: string; confirm: string };

// Structure only: the service checks the owner and the second factor. A run that changes data (set, `--clear`) needs
// `--confirm <organization name>`; the list mode takes none. Throws `UsageError` (or a `parseArgs` error) on any bad argument.
export function parseOrgBreakGlassArgs(argv: string[]): OrgBreakGlassArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "user-id": { type: "string" },
      clear: { type: "boolean" },
      confirm: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  const isUuid = (value: string): boolean => z.uuid().safeParse(value).success;
  const orgId = values["org-id"];
  if (orgId === undefined || !isUuid(orgId)) throw new UsageError("--org-id <uuid> is required");

  const userId = values["user-id"];
  if (userId !== undefined && !isUuid(userId)) throw new UsageError("--user-id <uuid> is not a uuid");
  if (values.clear && userId !== undefined) throw new UsageError("--clear and --user-id are two modes: pick one");

  const confirm = values.confirm;
  const needConfirm = (): string => {
    if (confirm === undefined || confirm.trim() === "") {
      throw new UsageError("--confirm <organization name> is required to set or clear");
    }
    return confirm;
  };
  if (values.clear) return { mode: "clear", orgId, confirm: needConfirm() };
  if (userId === undefined) {
    if (confirm !== undefined) throw new UsageError("--confirm goes with --user-id or --clear");
    return { mode: "list", orgId };
  }
  return { mode: "set", orgId, userId, confirm: needConfirm() };
}
