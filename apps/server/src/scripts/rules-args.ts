import {
  type CliDescription,
  isValidSenderPattern,
  senderRuleKinds,
  type SenderRuleKind,
  storedAddressForm,
  UsageError,
} from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "rules:add",
    subcommand: "add",
    summary: "Adds one sender rule (an address or a domain) to an organization or to one mailbox.",
    risk: "write",
    needs: ["db"],
    usage: `bun run rules:add --org-id <uuid> [--mailbox-id <uuid>] --pattern <address or domain> --kind ${senderRuleKinds.join("|")}`,
    exits: { 1: "the rule limit is reached, the mailbox is unknown or a failure", 3: "the database did not answer" },
  },
  {
    name: "rules:list",
    subcommand: "list",
    summary: "Lists the sender rules of an organization, with the rules of one mailbox when it is named.",
    risk: "read",
    needs: ["db"],
    usage: "bun run rules:list --org-id <uuid> [--mailbox-id <uuid>]",
    exits: { 1: "a failure", 3: "the database did not answer" },
  },
] satisfies readonly CliDescription[];

export type RulesCommand =
  | { command: "add"; orgId: string; mailboxId: string | null; pattern: string; kind: SenderRuleKind }
  | { command: "list"; orgId: string; mailboxId: string | null };

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseRulesArgs(argv: string[]): RulesCommand {
  const { values, positionals } = parseFlags({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "mailbox-id": { type: "string" },
      pattern: { type: "string" },
      kind: { type: "string" },
    },
    allowPositionals: true,
  });
  const uuid = z.uuid();
  const orgId = values["org-id"];
  const mailboxId = values["mailbox-id"];
  if (positionals.length !== 1 || (positionals[0] !== "add" && positionals[0] !== "list")) {
    throw new UsageError("the first argument is add or list");
  }
  if (orgId === undefined || !uuid.safeParse(orgId).success) throw new UsageError("--org-id <uuid> is required");
  if (mailboxId !== undefined && !uuid.safeParse(mailboxId).success) throw new UsageError("--mailbox-id is not a uuid");

  if (positionals[0] === "list") {
    if (values.pattern !== undefined || values.kind !== undefined) {
      throw new UsageError("list takes no --pattern or --kind");
    }
    return { command: "list", orgId, mailboxId: mailboxId ?? null };
  }
  const kind = z.enum(senderRuleKinds).safeParse(values.kind);
  if (!kind.success) throw new UsageError(`--kind is one of ${senderRuleKinds.join(", ")}`);
  if (values.pattern === undefined) throw new UsageError("--pattern is required");
  const pattern = storedAddressForm(values.pattern);
  if (!isValidSenderPattern(pattern)) throw new UsageError("--pattern is not an address or a domain");
  return { command: "add", orgId, mailboxId: mailboxId ?? null, pattern, kind: kind.data };
}
