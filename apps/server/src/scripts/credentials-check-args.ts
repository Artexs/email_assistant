import { parseArgs } from "node:util";

import type { CliDescription } from "@ea/core";

export const cliDescriptions = [
  {
    name: "credentials:check",
    summary: "Counts the stored mailbox secrets that the CREDENTIALS_KEY opens and the ones it does not.",
    risk: "read",
    needs: ["db"],
    usage: "bun run credentials:check",
    exits: {
      1: "the config or the database failed, also when it did not answer",
    },
    outputNote: "One line `credentials ok=<n> failed=<m>`: counts only. Exit 0 also when some secrets do not open.",
  },
] satisfies readonly CliDescription[];

// The tool takes no argument. A flag or a word throws a `parseArgs` error, which `runCli` maps to exit 2.
export function parseCredentialsCheckArgs(argv: string[]): void {
  parseArgs({ args: argv, options: {}, strict: true, allowPositionals: false });
}
