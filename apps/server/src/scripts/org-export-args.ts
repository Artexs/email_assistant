import { parseArgs } from "node:util";

import { z } from "zod";

import { isAgeRecipient } from "../modules/privacy";

export const usage = "usage: bun run org:export --org-id <uuid> --recipient <age1...> --out <path>";

// A uuid, one public `age` key and a path are required. null on any bad or missing argument.
export function parseOrgExportArgs(argv: string[]): { orgId: string; recipient: string; out: string } | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { "org-id": { type: "string" }, recipient: { type: "string" }, out: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return null;
  }
  const { "org-id": orgId, recipient, out } = values;
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) return null;
  if (recipient === undefined || !isAgeRecipient(recipient)) return null;
  if (out === undefined || out.trim() === "") return null;
  return { orgId, recipient, out };
}
