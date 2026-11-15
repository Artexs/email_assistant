import { parseArgs } from "node:util";

import { SLO_KINDS, type SloKind } from "@ea/core";

export const alertsUsage = "usage: bun run ops:alerts [--days <1-365>]";
export const alertTestUsage = `usage: bun run ops:alert-test (--kind <${SLO_KINDS.join("|")}> | --all)`;

export const DEFAULT_DAYS = 7;
const MAX_DAYS = 365;

/** `--days` as a whole number from 1 to 365 (default 7). null on any bad argument; the script prints the usage. */
export function parseOpsAlertsArgs(argv: string[]): { days: number } | null {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { days: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length > 0) return null;
    if (values.days === undefined) return { days: DEFAULT_DAYS };
    if (!/^\d{1,3}$/.test(values.days)) return null;
    const days = Number(values.days);
    return days >= 1 && days <= MAX_DAYS ? { days } : null;
  } catch {
    return null;
  }
}

/** One kind with `--kind`, or all five with `--all`; never both, never neither. null on any bad argument. */
export function parseOpsAlertTestArgs(argv: string[]): { kinds: SloKind[] } | null {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { kind: { type: "string" }, all: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length > 0) return null;
    const all = values.all === true;
    if (all === (values.kind !== undefined)) return null;
    if (all) return { kinds: [...SLO_KINDS] };
    const kind = SLO_KINDS.find((candidate) => candidate === values.kind);
    return kind === undefined ? null : { kinds: [kind] };
  } catch {
    return null;
  }
}
