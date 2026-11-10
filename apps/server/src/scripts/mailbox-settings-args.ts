import { parseArgs } from "node:util";

import { barCategories, toolSwitchNames, type BarCategory, type MailboxMode, type ToolSwitches } from "@ea/core";
import { z } from "zod";

import type { SyncFolderRow } from "../modules/mail";

export const usage = [
  "usage:",
  "  bun run mailbox:settings show   --org-id <uuid> --mailbox-id <uuid>",
  "  bun run mailbox:settings mode   --org-id <uuid> --mailbox-id <uuid> --mode shadow|assist [--keep-switches]",
  "  bun run mailbox:settings auto   --org-id <uuid> --mailbox-id <uuid> --category urgent|needs_reply|info|notification|spam --value on|off [--threshold 0.nn] [--force]",
  "  bun run mailbox:settings switch --org-id <uuid> --mailbox-id <uuid> --name move|mark_read|flag|move_unsure|create_draft --value on|off",
  "  bun run mailbox:settings sync-folder --org-id <uuid> --mailbox-id <uuid> --key offers|social|bills|junk --value on|off",
  "  bun run mailbox:settings expire-ready --org-id <uuid> --mailbox-id <uuid>",
  "  Exit 0: ok. Exit 1: usage error or failure. Exit 2: refused by the go/no-go gate.",
].join("\n");

export type SettingsCommand =
  | { kind: "show" | "expire-ready"; orgId: string; mailboxId: string }
  | { kind: "mode"; orgId: string; mailboxId: string; mode: MailboxMode; keepSwitches: boolean }
  | {
      kind: "auto";
      orgId: string;
      mailboxId: string;
      category: BarCategory;
      value: boolean;
      threshold?: number;
      force: boolean;
    }
  | { kind: "switch"; orgId: string; mailboxId: string; name: keyof ToolSwitches; value: boolean }
  | {
      kind: "sync-folder";
      orgId: string;
      mailboxId: string;
      key: "offers" | "social" | "bills" | "junk";
      value: boolean;
    };

const onOff = z.enum(["on", "off"]).transform((value) => value === "on");
const threshold = z
  .string()
  .regex(/^\d(\.\d+)?$/)
  .transform(Number)
  .pipe(z.number().gt(0).lte(1));

const common = { orgId: z.uuid(), mailboxId: z.uuid() };

// Returns undefined on any bad argument; the script prints the usage.
export function parseSettingsArgs(argv: string[]): SettingsCommand | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        mode: { type: "string" },
        "keep-switches": { type: "boolean" },
        category: { type: "string" },
        name: { type: "string" },
        key: { type: "string" },
        value: { type: "string" },
        threshold: { type: "string" },
        force: { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
    const ids = { orgId: values["org-id"], mailboxId: values["mailbox-id"] };
    const [kind, ...extra] = positionals;
    if (extra.length > 0) return undefined;
    // Each subcommand takes only its own flags.
    const allowed: Record<string, string[]> = {
      show: [],
      "expire-ready": [],
      mode: ["mode", "keep-switches"],
      auto: ["category", "value", "threshold", "force"],
      switch: ["name", "value"],
      "sync-folder": ["key", "value"],
    };
    const own = allowed[kind ?? ""];
    if (!own) return undefined;
    const given = Object.keys(values).filter((key) => key !== "org-id" && key !== "mailbox-id");
    if (given.some((key) => !own.includes(key))) return undefined;

    switch (kind) {
      case "show":
      case "expire-ready": {
        const parsed = z.object(common).parse(ids);
        return { kind, ...parsed };
      }
      case "mode": {
        const parsed = z.object({ ...common, mode: z.enum(["shadow", "assist"]) }).parse({ ...ids, mode: values.mode });
        return { kind, ...parsed, keepSwitches: values["keep-switches"] ?? false };
      }
      case "auto": {
        const parsed = z
          .object({
            ...common,
            category: z.enum(barCategories),
            value: onOff,
            threshold: threshold.optional(),
          })
          .parse({ ...ids, category: values.category, value: values.value, threshold: values.threshold });
        return {
          kind,
          orgId: parsed.orgId,
          mailboxId: parsed.mailboxId,
          category: parsed.category,
          value: parsed.value,
          ...(parsed.threshold === undefined ? {} : { threshold: parsed.threshold }),
          force: values.force ?? false,
        };
      }
      case "sync-folder": {
        const parsed = z
          .object({ ...common, key: z.enum(["offers", "social", "bills", "junk"]), value: onOff })
          .parse({ ...ids, key: values.key, value: values.value });
        return { kind, ...parsed };
      }
      default: {
        const parsed = z
          .object({ ...common, name: z.enum(toolSwitchNames), value: onOff })
          .parse({ ...ids, name: values.name, value: values.value });
        return { kind: "switch", ...parsed };
      }
    }
  } catch {
    return undefined;
  }
}

// One `show` line per sync folder row. An operator CLI on the server: the path may show here, never in a server log.
export function describeSyncFolder(row: SyncFolderRow): string {
  const cursor = row.uidvalidity === null || row.last_uid === null ? "none" : "set";
  return `sync folder ${row.key}: ${row.enabled ? "on" : "off"}, role ${row.role}, path ${row.path}, cursor ${cursor}`;
}
