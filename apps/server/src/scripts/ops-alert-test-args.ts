import { parseArgs } from "node:util";

import { type CliDescription, SLO_KINDS, type SloKind, UsageError } from "@ea/core";

export const cliDescriptions = [
  {
    name: "ops:alert-test",
    summary: "Sends the TEST text of one alert kind or of all kinds to the operator chat.",
    risk: "outside",
    needs: ["telegram"],
    usage: `bun run ops:alert-test (--kind <${SLO_KINDS.join("|")}> | --all)`,
    exits: { 1: "the config is bad or a send failed; the lines printed so far went out" },
  },
] satisfies readonly CliDescription[];

/** One kind with `--kind`, or all five with `--all`; never both, never neither. Throws `UsageError` (or a `parseArgs` error) on any bad argument. */
export function parseOpsAlertTestArgs(argv: string[]): { kinds: SloKind[] } {
  const { values } = parseArgs({
    args: argv,
    options: { kind: { type: "string" }, all: { type: "boolean" } },
    allowPositionals: false,
    strict: true,
  });
  const all = values.all === true;
  if (all === (values.kind !== undefined)) throw new UsageError("give exactly one of --kind and --all");
  if (all) return { kinds: [...SLO_KINDS] };
  const kind = SLO_KINDS.find((candidate) => candidate === values.kind);
  if (kind === undefined) throw new UsageError("--kind is not an alert kind");
  return { kinds: [kind] };
}
