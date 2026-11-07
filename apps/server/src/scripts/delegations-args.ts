import { parseArgs } from "node:util";

import { z } from "zod";

import type { DelegationStatus } from "../modules/delegation";

export const usage = [
  "usage:",
  "  bun run delegations:list --org-id <uuid> [--status drafted|sent|answered|overdue|done|cancelled] [--limit 50]",
  "  bun run delegations:done --org-id <uuid> --id <uuid>",
  "  Exit 0: ok. Exit 1: usage error or failure.",
].join("\n");

export type DelegationsCommand =
  | { kind: "list"; orgId: string; status: DelegationStatus | undefined; limit: number }
  | { kind: "done"; orgId: string; id: string };

const DEFAULT_LIMIT = 50;
const statusSchema = z.enum(["drafted", "sent", "answered", "overdue", "done", "cancelled"]);
const limitSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(1000));

// Returns undefined on any bad argument; the script prints the usage.
export function parseDelegationsArgs(argv: string[]): DelegationsCommand | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        status: { type: "string" },
        limit: { type: "string" },
        id: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length !== 1) return undefined;
    const orgId = z.uuid().parse(values["org-id"]);

    if (positionals[0] === "list") {
      if (values.id !== undefined) return undefined;
      return {
        kind: "list",
        orgId,
        status: values.status === undefined ? undefined : statusSchema.parse(values.status),
        limit: values.limit === undefined ? DEFAULT_LIMIT : limitSchema.parse(values.limit),
      };
    }
    if (positionals[0] === "done") {
      if (values.status !== undefined || values.limit !== undefined) return undefined;
      return { kind: "done", orgId, id: z.uuid().parse(values.id) };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
