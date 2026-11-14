import { parseArgs } from "node:util";

import { z } from "zod";

import { isAgeRecipient } from "../modules/privacy";

export const usage =
  "usage: bun run org:dsr --org-id <uuid> --address <address> --find [--recipient <age1...> --out <path>]";

export interface OrgDsrArgs {
  orgId: string;
  address: string;
  mode: "find";
  report?: { recipient: string; out: string };
}

// A uuid, an address and one mode are required. `--recipient` and `--out` come together and only with `--find`.
// The address is not checked here: a bad one is a refusal (`bad_address`), not a usage error. null on any usage error.
export function parseOrgDsrArgs(argv: string[]): OrgDsrArgs | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        address: { type: "string" },
        find: { type: "boolean" },
        recipient: { type: "string" },
        out: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return null;
  }
  const { "org-id": orgId, address, find, recipient, out } = values;
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) return null;
  if (address === undefined || address.trim() === "") return null;
  if (find !== true) return null;
  if (recipient === undefined && out === undefined) return { orgId, address, mode: "find" };
  if (recipient === undefined || out === undefined) return null;
  if (!isAgeRecipient(recipient) || out.trim() === "") return null;
  return { orgId, address, mode: "find", report: { recipient, out } };
}
