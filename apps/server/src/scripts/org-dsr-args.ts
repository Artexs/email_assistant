import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { isAgeRecipient } from "../modules/privacy";

export const cliDescriptions = [
  {
    name: "org:dsr",
    summary: "Finds or erases the data of one address in an organization, or checks the lower-case rule.",
    risk: "danger",
    needs: ["db"],
    usage:
      "bun run org:dsr --org-id <uuid> (--address <address> (--find [--recipient <age1...> --out <path>] | --erase --confirm <address>) | --rule-check)",
    exits: { 1: "refused (open actions, blocked, rule mismatch, wrong address) or failed: nothing was erased" },
    outputNote:
      "Counts, ids and table.column names; never the address. The record line names the organization and the date.",
  },
] satisfies readonly CliDescription[];

export type OrgDsrArgs =
  | { mode: "find"; orgId: string; address: string; report?: { recipient: string; out: string } }
  | { mode: "erase"; orgId: string; address: string; confirm: string }
  | { mode: "rule_check"; orgId: string };

// A uuid, an address and one mode are required. `--recipient` and `--out` come together and only with `--find`;
// `--confirm` is required with `--erase` and refused with `--find`. Both modes in one call is a usage error.
// `--rule-check` stands alone with `--org-id` (it needs no address); any other option with it is a usage error.
// The address is not checked here: a bad one is a refusal (`bad_address`), not a usage error. Throws `UsageError` (or a `parseArgs` error) on any usage error.
export function parseOrgDsrArgs(argv: string[]): OrgDsrArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      address: { type: "string" },
      find: { type: "boolean" },
      erase: { type: "boolean" },
      confirm: { type: "string" },
      recipient: { type: "string" },
      out: { type: "string" },
      "rule-check": { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });
  const { "org-id": orgId, address, find, erase, confirm, recipient, out, "rule-check": ruleCheck } = values;
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id <uuid> is required");
  if (ruleCheck === true) {
    const others = [address, find, erase, confirm, recipient, out];
    if (!others.every((value) => value === undefined)) throw new UsageError("--rule-check takes only --org-id");
    return { mode: "rule_check", orgId };
  }
  if (address === undefined || address.trim() === "") throw new UsageError("--address <address> is required");
  if (find === true && erase === true) throw new UsageError("--find and --erase are two modes: pick one");
  if (erase === true) {
    if (recipient !== undefined || out !== undefined) throw new UsageError("--recipient and --out go with --find");
    if (confirm === undefined || confirm.trim() === "") {
      throw new UsageError("--confirm <address> is required with --erase");
    }
    return { mode: "erase", orgId, address, confirm };
  }
  if (find !== true) throw new UsageError("--find, --erase or --rule-check is required");
  if (confirm !== undefined) throw new UsageError("--confirm goes with --erase");
  if (recipient === undefined && out === undefined) return { mode: "find", orgId, address };
  if (recipient === undefined || out === undefined) throw new UsageError("--recipient and --out come together");
  if (!isAgeRecipient(recipient)) throw new UsageError("--recipient is not an age public key");
  if (out.trim() === "") throw new UsageError("--out <path> is empty");
  return { mode: "find", orgId, address, report: { recipient, out } };
}
