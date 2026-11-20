import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "org:delete",
    summary: "Deletes one organization and all its data after the operator types its name.",
    risk: "danger",
    needs: ["db"],
    usage: "bun run org:delete --org-id <uuid> --confirm <organization name> [--lock-timeout-ms <ms>]",
    exits: { 1: "organization not found, wrong name, a busy lock or a failure: nothing was deleted" },
    outputNote:
      "After a delete it prints the mailbox addresses, so that the operator tells the owner which passwords to change.",
  },
] satisfies readonly CliDescription[];

export interface OrgDeleteArgs {
  orgId: string;
  confirmName: string;
  lockTimeoutMs?: number;
}

// A uuid and a non-empty name are required; the lock timeout in milliseconds is optional. Throws `UsageError` (or a
// `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseOrgDeleteArgs(argv: string[]): OrgDeleteArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      confirm: { type: "string" },
      "lock-timeout-ms": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const orgId = values["org-id"];
  const confirmName = values.confirm;
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id <uuid> is required");
  if (confirmName === undefined || confirmName.trim() === "") {
    throw new UsageError("--confirm <organization name> is required");
  }
  const timeout = values["lock-timeout-ms"];
  if (timeout === undefined) return { orgId, confirmName };
  if (!/^[1-9][0-9]{0,8}$/.test(timeout)) throw new UsageError("--lock-timeout-ms is a whole number of milliseconds");
  return { orgId, confirmName, lockTimeoutMs: Number(timeout) };
}
