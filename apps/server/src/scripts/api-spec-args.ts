import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

export const cliDescriptions = [
  {
    name: "api:spec",
    summary: "Writes docs/api/openapi.json from the app routes, or with --check compares it.",
    risk: "dev",
    needs: ["none"],
    usage: "bun run api:spec [--check]",
    exits: { 1: "--check found the committed file different from the app (openapi_drift)" },
  },
] satisfies readonly CliDescription[];

/** `{ check }`. Throws `UsageError` (or a `parseArgs` error, also exit 2) on any bad argument. */
export function parseApiSpecArgs(argv: string[]): { check: boolean } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { check: { type: "boolean" } },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 0) throw new UsageError("api:spec takes no operand");
  return { check: values.check === true };
}
