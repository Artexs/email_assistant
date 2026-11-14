import { parseArgs } from "node:util";

import { z } from "zod";

import { isAgeRecipient } from "../modules/privacy";

export const usage =
  "usage: bun run org:dsr --org-id <uuid> --address <address> (--find [--recipient <age1...> --out <path>] | --erase --confirm <address>)";

export type OrgDsrArgs =
  | { mode: "find"; orgId: string; address: string; report?: { recipient: string; out: string } }
  | { mode: "erase"; orgId: string; address: string; confirm: string };

// A uuid, an address and one mode are required. `--recipient` and `--out` come together and only with `--find`;
// `--confirm` is required with `--erase` and refused with `--find`. Both modes in one call is a usage error.
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
        erase: { type: "boolean" },
        confirm: { type: "string" },
        recipient: { type: "string" },
        out: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return null;
  }
  const { "org-id": orgId, address, find, erase, confirm, recipient, out } = values;
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) return null;
  if (address === undefined || address.trim() === "") return null;
  if (find === true && erase === true) return null;
  if (erase === true) {
    if (recipient !== undefined || out !== undefined) return null;
    if (confirm === undefined || confirm.trim() === "") return null;
    return { mode: "erase", orgId, address, confirm };
  }
  if (find !== true || confirm !== undefined) return null;
  if (recipient === undefined && out === undefined) return { mode: "find", orgId, address };
  if (recipient === undefined || out === undefined) return null;
  if (!isAgeRecipient(recipient) || out.trim() === "") return null;
  return { mode: "find", orgId, address, report: { recipient, out } };
}
