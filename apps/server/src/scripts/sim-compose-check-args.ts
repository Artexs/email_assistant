import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

export const cliDescriptions = [
  {
    name: "sim:check",
    summary: "Checks the rules of the sim stack Compose file, in CI.",
    risk: "read",
    needs: ["none"],
    usage:
      "bun run sim:check [compose file]\n  Default file: deploy/compose.sim.yaml. It prints no value of the file, only the broken rules.",
    exits: { 1: "the file did not load or breaks a rule" },
  },
] satisfies readonly CliDescription[];

// The optional file argument is the only positional. A flag or a second word is a usage error.
export function parseSimCheckArgs(argv: string[]): { file: string | undefined } {
  const { positionals } = parseArgs({ args: argv, options: {}, strict: true, allowPositionals: true });
  if (positionals.length > 1) throw new UsageError("at most one file");
  return { file: positionals[0] };
}
