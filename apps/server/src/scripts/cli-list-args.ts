import { parseArgs } from "node:util";

import { CLI_NEEDS, CLI_RISKS, type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "cli:list",
    summary: "Lists every command-line tool with its risk, needs and summary.",
    risk: "read",
    needs: ["none"],
    usage: "bun run cli:list [--json]",
  },
] satisfies readonly CliDescription[];

export interface CliListArgs {
  json: boolean;
}

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any other flag or operand.
export function parseCliListArgs(argv: string[]): CliListArgs {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" } }, strict: true });
  if (values.json === false) {
    throw new UsageError("--json takes no value");
  }
  return { json: values.json === true };
}

export const cliToolRowSchema = z.object({
  name: z.string(),
  subcommand: z.string().optional(),
  summary: z.string(),
  risk: z.enum(CLI_RISKS),
  needs: z.array(z.enum(CLI_NEEDS)).min(1),
  usage: z.string(),
  exits: z.record(z.string(), z.string()).optional(),
  outputNote: z.string().optional(),
  file: z.string(),
  available: z.boolean(),
});

/** The `--json` value of `cli:list`. */
export const cliListSchema = z.object({ tools: z.array(cliToolRowSchema) });
export type CliList = z.infer<typeof cliListSchema>;
