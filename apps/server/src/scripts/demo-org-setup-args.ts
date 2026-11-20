import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

export const cliDescriptions = [
  {
    name: "demo:org-setup",
    summary: "Imports a demo seed file as the demo organization of the docs shots, with a known owner sign-in.",
    risk: "dev",
    needs: ["db"],
    usage: [
      "bun run demo:org-setup --seed <file> --out <file>",
      "  --seed: the demo seed file to import. --out: where the owner's sign-in is written for the shot spec.",
      "  Only an e2e database (the name ends in _e2e): any other database is refused with exit 1.",
      "  Needs DATABASE_URL and MIGRATOR_DATABASE_URL.",
    ].join("\n"),
    exits: { 1: "failed, or refused: the database is not an e2e database" },
  },
] satisfies readonly CliDescription[];

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument. Both paths are made absolute.
export function parseDemoOrgSetupArgs(argv: readonly string[]): { seed: string; out: string } {
  const { values } = parseArgs({
    args: [...argv],
    options: { seed: { type: "string" }, out: { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  if (values.seed === undefined || values.seed === "") throw new UsageError("--seed is needed");
  if (values.out === undefined || values.out === "") throw new UsageError("--out is needed");
  return { seed: resolve(values.seed), out: resolve(values.out) };
}
