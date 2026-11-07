import { parseArgs } from "node:util";

import { ADDRESS_PATTERN } from "@ea/core";
import { z } from "zod";

export const usage = [
  "usage:",
  "  bun run delegates:add     --org-id <uuid> --name <text> --email <address> [--tags a,b,c]",
  "  bun run delegates:list    --org-id <uuid> [--all]",
  "  bun run delegates:disable --org-id <uuid> --id <uuid>",
  "  bun run delegates:enable  --org-id <uuid> --id <uuid>",
  "  Exit 0: ok. Exit 1: usage error or failure. Exit 2: refused.",
].join("\n");

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

// Returns undefined on any bad argument; the script prints the usage.
export function parseDelegatesArgs(argv: string[]): DelegatesCommand | undefined {
  try {
    const { values, positionals } = parseArgs({
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
      strict: true,
    });
    if (positionals.length !== 1) return undefined;
    const kind = positionals[0];
    // Each subcommand takes only its own flags.
    const allowed: Record<string, string[]> = {
      add: ["name", "email", "tags"],
      list: ["all"],
      disable: ["id"],
      enable: ["id"],
    };
    const own = allowed[kind ?? ""];
    if (!own) return undefined;
    if (Object.keys(values).some((key) => key !== "org-id" && !own.includes(key))) return undefined;

    switch (kind) {
      case "add": {
        const parsed = addSchema.parse({ orgId: values["org-id"], name: values.name, email: values.email });
        return { kind, ...parsed, tags: parseTags(values.tags) };
      }
      case "list":
        return { kind, orgId: z.uuid().parse(values["org-id"]), all: values.all ?? false };
      default: {
        const parsed = idSchema.parse({ orgId: values["org-id"], id: values.id });
        return { kind: kind === "enable" ? "enable" : "disable", ...parsed };
      }
    }
  } catch {
    return undefined;
  }
}
