import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { isAgeRecipient } from "../modules/privacy";

export const cliDescriptions = [
  {
    name: "org:export",
    summary: "Writes one organization's data as an age-encrypted file and prints one count per table.",
    risk: "danger",
    needs: ["db"],
    usage: "bun run org:export --org-id <uuid> --recipient <age1...> --out <path>",
    exits: { 1: "organization not found, a refused target file or a failure: no file was written" },
  },
] satisfies readonly CliDescription[];

export interface OrgExportArgs {
  orgId: string;
  recipient: string;
  out: string;
}

// A uuid, one public `age` key and a path are required. Throws `UsageError` (or a `parseArgs` error) on any bad or missing argument.
export function parseOrgExportArgs(argv: string[]): OrgExportArgs {
  const { values } = parseArgs({
    args: argv,
    options: { "org-id": { type: "string" }, recipient: { type: "string" }, out: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const { "org-id": orgId, recipient, out } = values;
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id <uuid> is required");
  if (recipient === undefined || !isAgeRecipient(recipient)) throw new UsageError("--recipient <age1...> is required");
  if (out === undefined || out.trim() === "") throw new UsageError("--out <path> is required");
  return { orgId, recipient, out };
}
