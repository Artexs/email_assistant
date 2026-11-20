import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

export const cliDescriptions = [
  {
    name: "ops:alerts",
    summary: "Prints one line per operator alert of the last days: kind, times, notices and facts.",
    risk: "read",
    needs: ["db"],
    usage: "bun run ops:alerts [--days <1-365>]",
  },
] satisfies readonly CliDescription[];

export const DEFAULT_DAYS = 7;
const MAX_DAYS = 365;

/** `--days` as a whole number from 1 to 365 (default 7). Throws `UsageError` (or a `parseArgs` error) on any bad argument. */
export function parseOpsAlertsArgs(argv: string[]): { days: number } {
  const { values } = parseArgs({
    args: argv,
    options: { days: { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  if (values.days === undefined) return { days: DEFAULT_DAYS };
  const days = /^\d{1,3}$/.test(values.days) ? Number(values.days) : 0;
  if (days < 1 || days > MAX_DAYS) throw new UsageError(`--days is a whole number from 1 to ${MAX_DAYS}`);
  return { days };
}
