import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import type { DelegationStatus } from "../modules/delegation";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "delegations:list",
    subcommand: "list",
    summary: "Lists the delegations of an organization, newest first, with an optional status filter.",
    risk: "read",
    needs: ["db"],
    usage:
      "bun run delegations:list --org-id <uuid> [--status drafted|sent|answered|overdue|done|cancelled] [--limit 50]",
    exits: { 1: "the organization is unknown or a failure", 3: "the database did not answer" },
  },
  {
    name: "delegations:done",
    subcommand: "done",
    summary: "Closes one answered or overdue delegation; its pending reminders expire.",
    risk: "write",
    needs: ["db"],
    usage: "bun run delegations:done --org-id <uuid> --id <uuid>",
    exits: {
      1: "the delegation is unknown, not closable or a failure",
      3: "the database did not answer",
    },
  },
] satisfies readonly CliDescription[];

export type DelegationsCommand =
  | { kind: "list"; orgId: string; status: DelegationStatus | undefined; limit: number }
  | { kind: "done"; orgId: string; id: string };

const DEFAULT_LIMIT = 50;
const statusSchema = z.enum(["drafted", "sent", "answered", "overdue", "done", "cancelled"]);
const limitSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(1000));

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseDelegationsArgs(argv: string[]): DelegationsCommand {
  const { values, positionals } = parseFlags({
    args: argv,
    options: {
      "org-id": { type: "string" },
      status: { type: "string" },
      limit: { type: "string" },
      id: { type: "string" },
    },
    allowPositionals: true,
  });
  const command = positionals[0];
  if (positionals.length !== 1 || (command !== "list" && command !== "done")) {
    throw new UsageError("the first argument is list or done");
  }
  const orgId = z.uuid().safeParse(values["org-id"]);
  if (!orgId.success) throw new UsageError("--org-id <uuid> is required");

  if (command === "list") {
    if (values.id !== undefined) throw new UsageError("list takes no --id");
    const status = values.status === undefined ? undefined : statusSchema.safeParse(values.status);
    if (status && !status.success) throw new UsageError(`--status is one of ${statusSchema.options.join(", ")}`);
    const limit = values.limit === undefined ? undefined : limitSchema.safeParse(values.limit);
    if (limit && !limit.success) throw new UsageError("--limit is a whole number from 1 to 1000");
    return { kind: "list", orgId: orgId.data, status: status?.data, limit: limit?.data ?? DEFAULT_LIMIT };
  }
  if (values.status !== undefined || values.limit !== undefined)
    throw new UsageError("done takes no --status or --limit");
  const id = z.uuid().safeParse(values.id);
  if (!id.success) throw new UsageError("--id <uuid> is required");
  return { kind: "done", orgId: orgId.data, id: id.data };
}
