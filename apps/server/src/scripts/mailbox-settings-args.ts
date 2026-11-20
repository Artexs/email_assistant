import {
  barCategories,
  UsageError,
  type CliDescription,
  replySwitchNames,
  toolSwitchNames,
  urgencyProfileSchema,
  type BarCategory,
  type MailboxMode,
  type SentSyncView,
  type ToolSwitches,
  type UrgencyProfile,
} from "@ea/core";
import { z } from "zod";

import type { SyncFolderRow } from "../modules/mail";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "mailbox:settings",
    summary: "Shows or changes the settings of one mailbox: mode, auto, switches, folders, urgency.",
    risk: "write",
    needs: ["db"],
    usage: [
      "bun run mailbox:settings show   --org-id <uuid> --mailbox-id <uuid>",
      "  bun run mailbox:settings mode   --org-id <uuid> --mailbox-id <uuid> --mode shadow|assist [--keep-switches]",
      "  bun run mailbox:settings auto   --org-id <uuid> --mailbox-id <uuid> --category urgent|needs_reply|info|notification|spam --value on|off [--threshold 0.nn] [--force]",
      "  bun run mailbox:settings switch --org-id <uuid> --mailbox-id <uuid> --name move|mark_read|flag|move_unsure|create_draft|reply_drafts --value on|off",
      "  bun run mailbox:settings sync-folder --org-id <uuid> --mailbox-id <uuid> --key offers|social|bills|junk --value on|off",
      "  bun run mailbox:settings sent-sync --org-id <uuid> --mailbox-id <uuid> --value on|off   (consent to read Sent: turn it on only on the owner's instruction)",
      "  bun run mailbox:settings urgency --org-id <uuid> --mailbox-id <uuid> (--file <path.json> | --clear)",
      "  bun run mailbox:settings expire-ready --org-id <uuid> --mailbox-id <uuid>",
    ].join("\n"),
    exits: { 1: "refused by the go/no-go gate or failed", 3: "the database did not answer" },
  },
] satisfies readonly CliDescription[];

/** The usage text of the tool, for the line that a refused urgency file prints. */
export const usage = cliDescriptions.map((description) => description.usage).join("\n");

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
    }
  | { kind: "sent-sync"; orgId: string; mailboxId: string; value: boolean }
  | { kind: "urgency"; orgId: string; mailboxId: string; source: { file: string } | { clear: true } };

const onOff = z.enum(["on", "off"]).transform((value) => value === "on");
const threshold = z
  .string()
  .regex(/^\d(\.\d+)?$/)
  .transform(Number)
  .pipe(z.number().gt(0).lte(1));

const common = { orgId: z.uuid(), mailboxId: z.uuid() };

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseSettingsArgs(argv: string[]): SettingsCommand {
  try {
    const { values, positionals } = parseFlags({
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
        file: { type: "string" },
        clear: { type: "boolean" },
      },
      allowPositionals: true,
    });
    const ids = { orgId: values["org-id"], mailboxId: values["mailbox-id"] };
    const [kind, ...extra] = positionals;
    if (extra.length > 0) throw new UsageError("one subcommand and no other operand");
    // Each subcommand takes only its own flags.
    const allowed: Record<string, string[]> = {
      show: [],
      "expire-ready": [],
      mode: ["mode", "keep-switches"],
      auto: ["category", "value", "threshold", "force"],
      switch: ["name", "value"],
      "sync-folder": ["key", "value"],
      "sent-sync": ["value"],
      urgency: ["file", "clear"],
    };
    const own = allowed[kind ?? ""];
    if (!own)
      throw new UsageError(
        "the first argument is show, mode, auto, switch, sync-folder, sent-sync, urgency or expire-ready"
      );
    const given = Object.keys(values).filter((key) => key !== "org-id" && key !== "mailbox-id");
    const foreign = given.filter((key) => !own.includes(key));
    if (foreign.length > 0)
      throw new UsageError(`${kind} does not take ${foreign.map((key) => `--${key}`).join(", ")}`);

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
      case "urgency": {
        const parsed = z.object(common).parse(ids);
        // Exactly one of the two.
        if ((values.file === undefined) === (values.clear === undefined)) {
          throw new UsageError("urgency takes --file or --clear, not none and not both");
        }
        if (values.file !== undefined) {
          return { kind, ...parsed, source: { file: z.string().min(1).parse(values.file) } };
        }
        return { kind, ...parsed, source: { clear: true } };
      }
      case "sync-folder": {
        const parsed = z
          .object({ ...common, key: z.enum(["offers", "social", "bills", "junk"]), value: onOff })
          .parse({ ...ids, key: values.key, value: values.value });
        return { kind, ...parsed };
      }
      case "sent-sync": {
        const parsed = z.object({ ...common, value: onOff }).parse({ ...ids, value: values.value });
        return { kind, ...parsed };
      }
      default: {
        const parsed = z
          .object({ ...common, name: z.enum([...toolSwitchNames, ...replySwitchNames]), value: onOff })
          .parse({ ...ids, name: values.name, value: values.value });
        return { kind: "switch", ...parsed };
      }
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new UsageError(`bad or missing argument: ${error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
    }
    throw error;
  }
}

// One `show` line per sync folder row. An operator CLI on the server: the path may show here, never in a server log.
export function describeSyncFolder(row: SyncFolderRow): string {
  const cursor = row.uidvalidity === null || row.last_uid === null ? "none" : "set";
  return `sync folder ${row.key}: ${row.enabled ? "on" : "off"}, role ${row.role}, path ${row.path}, cursor ${cursor}`;
}

// The `show` line of "Track my sent mail". An operator CLI on the server: the folder path may show here, never in a server log.
export function describeSentSync(view: SentSyncView | null): string {
  if (view === null) return "sent: off (flag)";
  const parts = [
    view.enabled ? "on" : "off",
    `folder ${view.folder ?? "none"}`,
    `stored ${view.storedCount}`,
    `last ${view.lastSentAt ?? "none"}`,
    view.firstPassDone ? "first pass done" : "first pass pending",
    `error ${view.errorCode ?? "none"}`,
  ];
  return `sent: ${parts.join(", ")}${view.flagOn ? "" : ", paused (flag off)"}`;
}

export type UrgencyFileResult =
  | { ok: true; profile: UrgencyProfile }
  // `paths`: the Zod issue paths, no values. Empty when the text is not JSON.
  | { ok: false; reason: "not_json" | "schema"; paths: string[] };

// The file holds the profile itself: `{ "topics": [...], "deadlines": [...] }`. The profile can name people, so the
// result carries issue paths and never a value.
export function parseUrgencyFile(text: string): UrgencyFileResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json", paths: [] };
  }
  const parsed = urgencyProfileSchema.safeParse(json);
  if (parsed.success) return { ok: true, profile: parsed.data };
  return {
    ok: false,
    reason: "schema",
    paths: parsed.error.issues.map((issue) => issue.path.map(String).join(".") || "(root)"),
  };
}

// Counts only: never a label or a keyword.
export function describeUrgency(profile: UrgencyProfile | null): string {
  return profile ? `urgency topics=${profile.topics.length} deadlines=${profile.deadlines.length}` : "urgency none";
}
