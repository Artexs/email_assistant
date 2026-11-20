import { type CliDescription } from "@ea/core";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "push:keys",
    summary: "Prints a new VAPID key pair as the three .env lines of Web Push.",
    risk: "read",
    needs: ["none"],
    usage: "bun run push:keys",
    outputNote: "prints a new private key once, for the operator's `.env`",
  },
] satisfies readonly CliDescription[];

// The tool takes no argument: any flag or operand is a usage error, before a key exists.
export function parsePushKeysArgs(argv: string[]): void {
  parseFlags({ args: argv, options: {} });
}
