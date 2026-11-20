import { parseArgs } from "node:util";

import type { CliDescription } from "@ea/core";

export const cliDescriptions = [
  {
    name: "lab:env-check",
    summary: "Checks that the env is the sim stack, before a sim container starts its program.",
    risk: "read",
    needs: ["none"],
    usage: "bun run lab:env-check",
    exits: { 1: "the env is not the sim stack, or the lab-01 corpus did not load" },
    outputNote:
      "Issue codes on stdout, one per line (`[lab-env-check] <code>`), never a value; `ok` when there is none. `deploy/compose.sim.yaml` and CI read stdout.",
  },
] satisfies readonly CliDescription[];

// The tool takes no argument. A flag or a word throws a `parseArgs` error, which `runCli` maps to exit 2.
export function parseLabEnvCheckArgs(argv: string[]): void {
  parseArgs({ args: argv, options: {}, strict: true, allowPositionals: false });
}
