import { ADDRESS_PATTERN, type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

const FAILED_EXITS = { 1: "a refusal, an unknown delegate or a failure", 3: "the database did not answer" } as const;

export const cliDescriptions = [
  {
    name: "delegates:add",
    subcommand: "add",
    summary: "Adds one delegate (a person who gets tasks) to an organization.",
    risk: "write",
    needs: ["db"],
    usage: "bun run delegates:add --org-id <uuid> --name <text> --email <address> [--tags a,b,c]",
    exits: { 1: "the address is a mailbox of the organization, a field is refused or a failure", 3: FAILED_EXITS[3] },
  },
  {
    name: "delegates:list",
    subcommand: "list",
    summary: "Lists the active delegates of an organization.",
    risk: "read",
    needs: ["db"],
    usage: "bun run delegates:list --org-id <uuid> [--all]\n  --all also lists the disabled delegates.",
    exits: { 1: "a failure", 3: FAILED_EXITS[3] },
  },
  {
    name: "delegates:disable",
    subcommand: "disable",
    summary: "Switches one delegate off.",
    risk: "write",
    needs: ["db"],
    usage: "bun run delegates:disable --org-id <uuid> --id <uuid>",
    exits: FAILED_EXITS,
  },
  {
    name: "delegates:enable",
    subcommand: "enable",
    summary: "Switches one delegate on.",
    risk: "write",
    needs: ["db"],
    usage: "bun run delegates:enable --org-id <uuid> --id <uuid>",
    exits: FAILED_EXITS,
  },
] satisfies readonly CliDescription[];

export type DelegatesCommand =
  | { kind: "add"; orgId: string; name: string; email: string; tags: string[] }
  | { kind: "list"; orgId: string; all: boolean }
  | { kind: "disable" | "enable"; orgId: string; id: string };

const addSchema = z.object({
  orgId: z.uuid(),
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().regex(ADDRESS_PATTERN),
});
const idSchema = z.object({ orgId: z.uuid(), id: z.uuid() });

function parseTags(text: string | undefined): string[] {
  const tags = (text ?? "").split(",").map((tag) => tag.trim().toLowerCase());
  return [...new Set(tags.filter((tag) => tag !== ""))];
}

// What a failed schema says: the names of the bad fields, never a value.
function badFields(error: z.ZodError): UsageError {
  return new UsageError(`bad or missing argument: ${error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
}

// Each subcommand takes only its own flags.
const OWN_FLAGS: Record<string, string[]> = {
  add: ["name", "email", "tags"],
  list: ["all"],
  disable: ["id"],
  enable: ["id"],
};

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument. It checks the form of
// the address only: the service refuses a mailbox address of the organization (exit 1).
export function parseDelegatesArgs(argv: string[]): DelegatesCommand {
  const { values, positionals } = parseFlags({
    args: argv,
    options: {
      "org-id": { type: "string" },
      name: { type: "string" },
      email: { type: "string" },
      tags: { type: "string" },
      all: { type: "boolean" },
      id: { type: "string" },
    },
    allowPositionals: true,
  });
  const kind = positionals[0];
  const own = kind === undefined ? undefined : OWN_FLAGS[kind];
  if (positionals.length !== 1 || !own) throw new UsageError("the first argument is add, list, disable or enable");
  if (Object.keys(values).some((key) => key !== "org-id" && !own.includes(key))) {
    throw new UsageError(`${kind} does not take every flag that was given`);
  }

  if (kind === "add") {
    const parsed = addSchema.safeParse({ orgId: values["org-id"], name: values.name, email: values.email });
    if (!parsed.success) throw badFields(parsed.error);
    return { kind, ...parsed.data, tags: parseTags(values.tags) };
  }
  if (kind === "list") {
    const orgId = z.uuid().safeParse(values["org-id"]);
    if (!orgId.success) throw badFields(orgId.error);
    return { kind, orgId: orgId.data, all: values.all ?? false };
  }
  const parsed = idSchema.safeParse({ orgId: values["org-id"], id: values.id });
  if (!parsed.success) throw badFields(parsed.error);
  return { kind: kind === "enable" ? "enable" : "disable", ...parsed.data };
}
