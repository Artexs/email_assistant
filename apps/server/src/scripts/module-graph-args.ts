import { parseArgs } from "node:util";

import type { CliDescription } from "@ea/core";

export const cliDescriptions = [
  {
    name: "graph:modules",
    summary: "Writes the module graph files in docs/diagrams from the imports of the server modules.",
    risk: "dev",
    needs: ["none"],
    usage: "bun run graph:modules",
  },
] satisfies readonly CliDescription[];

/** The tool takes no argument. Throws a `parseArgs` error (exit 2) on any flag or operand. */
export function parseModuleGraphArgs(argv: string[]): void {
  parseArgs({ args: argv, options: {}, allowPositionals: false, strict: true });
}
