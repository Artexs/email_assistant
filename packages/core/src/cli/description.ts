import { z } from "zod";

// Pure vocabulary of the command-line standard (docs/cli.md). No DB, no network, no process.env.
export const CLI_RISKS = ["read", "dev", "write", "cost", "outside", "danger"] as const;
export type CliRisk = (typeof CLI_RISKS)[number];

export const CLI_NEEDS = [
  "none",
  "db",
  "greenmail",
  "imap",
  "smtp",
  "telegram",
  "llm",
  "agentmail",
  "dns",
  "vps",
  "docker",
  "git",
] as const;
export type CliNeed = (typeof CLI_NEEDS)[number];

// One exit-code table for every tool. 130 (Ctrl-C) is not here: `runCli` installs no signal handler.
export const EXIT = { ok: 0, failed: 1, usage: 2, unreachable: 3, incomplete: 4 } as const;

export const CLI_SUMMARY_MAX = 100;

export interface CliDescription {
  name: string; // the package.json key, "org:delete"
  subcommand?: string; // argv[0] for a file with several names ("add" for rules:add)
  summary: string; // one sentence, at most 100 characters, ends with "."
  risk: CliRisk;
  needs: readonly CliNeed[]; // ["none"] or a list without "none"
  usage: string; // first line "bun run <name> …"; more lines allowed; no "usage:" prefix
  exits?: Partial<Record<1 | 3 | 4, string>>; // tool meaning of a code, one clause
  outputNote?: string; // the one allowed exception to "ids and counts only"
}

// Message: safe text, no input values. `runCli` maps it to exit 2.
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const NAME_PART = "[a-z0-9]+(?:-[a-z0-9]+)*";
const NAME_PATTERN = new RegExp(`^${NAME_PART}(?::${NAME_PART})*$`);
const SUBCOMMAND_PATTERN = new RegExp(`^${NAME_PART}$`);
const USAGE_PATTERN = /^bun run \S/;

const exitText = z.string().min(1).max(CLI_SUMMARY_MAX);

export const cliDescriptionSchema = z
  .strictObject({
    name: z.string().regex(NAME_PATTERN, "name is a package.json key: kebab-case parts joined by ':'"),
    subcommand: z.string().regex(SUBCOMMAND_PATTERN).optional(),
    summary: z
      .string()
      .max(CLI_SUMMARY_MAX, `summary is at most ${CLI_SUMMARY_MAX} characters`)
      .regex(/^\S.*\.$/, "summary is one sentence that ends with '.'")
      .refine((value) => !value.includes("\n"), "summary is one line"),
    risk: z.enum(CLI_RISKS),
    needs: z
      .array(z.enum(CLI_NEEDS))
      .min(1)
      .refine((needs) => new Set(needs).size === needs.length, "needs has no duplicate")
      .refine((needs) => !needs.includes("none") || needs.length === 1, "'none' stands alone"),
    usage: z
      .string()
      .refine((usage) => USAGE_PATTERN.test(usage), "usage starts with 'bun run <name>'")
      .refine((usage) => !usage.endsWith("\n"), "usage has no trailing newline"),
    exits: z.strictObject({ 1: exitText.optional(), 3: exitText.optional(), 4: exitText.optional() }).optional(),
    outputNote: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const firstLine = value.usage.split("\n")[0] ?? "";
    if (!firstLine.startsWith(`bun run ${value.name}`)) {
      ctx.addIssue({ code: "custom", path: ["usage"], message: "usage first line names the tool" });
    }
  });
