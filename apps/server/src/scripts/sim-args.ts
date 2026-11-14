import { parseArgs } from "node:util";

import { simParts, type SimPart } from "@ea/core";

export const usage = [
  "usage:",
  "  bun run sim plan <scenario> [--root <dir>] [--force]",
  "  bun run sim status <scenario> [--root <dir>]",
  "  bun run sim brief <scenario> --part dev|holdout|week --batch <NNN> [--root <dir>]",
  "  bun run sim check <scenario> [--part dev|holdout|week] [--batches <from>-<to>] [--root <dir>]",
  "  bun run sim blind-export <scenario> --part <part> --batches <from>-<to> [--root <dir>]",
  "  bun run sim label-import <scenario> --part <part> --batch <NNN> --checker <model id> --file <path> [--root <dir>]",
  "  bun run sim stale <scenario> --part <part> --batches <from>-<to> [--root <dir>]",
  "  bun run sim reconcile <scenario> --part <part> --batches <from>-<to> [--root <dir>]",
  "  Exit 0: ok. Exit 1: usage error, refusal or an issue found.",
].join("\n");

export interface BatchRange {
  from: number;
  to: number;
}

interface Base {
  scenario: string;
  // Folder that holds the corpus folders; the default is evals/sim of the repo.
  root?: string;
}

export type SimCommand =
  | (Base & { kind: "plan"; force: boolean })
  | (Base & { kind: "status" })
  | (Base & { kind: "brief"; part: SimPart; batch: number })
  | (Base & { kind: "check"; part?: SimPart; range?: BatchRange })
  | (Base & { kind: "blind-export"; part: SimPart; range: BatchRange })
  | (Base & { kind: "stale"; part: SimPart; range: BatchRange })
  | (Base & { kind: "reconcile"; part: SimPart; range: BatchRange })
  | (Base & { kind: "label-import"; part: SimPart; batch: number; checker: string; file: string });

const SCENARIO_ID = /^[a-z0-9-]{1,40}$/;

function parseBatch(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d{1,3}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= 1 ? n : undefined;
}

function parseRange(text: string | undefined): BatchRange | undefined {
  const match = /^(\d{1,3})-(\d{1,3})$/.exec(text ?? "");
  if (match === null) return undefined;
  const from = Number(match[1]);
  const to = Number(match[2]);
  return from >= 1 && to >= from ? { from, to } : undefined;
}

function parsePart(text: string | undefined): SimPart | undefined {
  return simParts.find((part) => part === text);
}

// Each command takes only its own flags.
const allowed: Record<string, readonly string[]> = {
  plan: ["force"],
  status: [],
  brief: ["part", "batch"],
  check: ["part", "batches"],
  "blind-export": ["part", "batches"],
  "label-import": ["part", "batch", "checker", "file"],
  stale: ["part", "batches"],
  reconcile: ["part", "batches"],
};

// Returns undefined on any bad argument; the script prints the usage.
export function parseSimArgs(argv: string[]): SimCommand | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        root: { type: "string" },
        force: { type: "boolean" },
        part: { type: "string" },
        batch: { type: "string" },
        batches: { type: "string" },
        checker: { type: "string" },
        file: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    const [kind, scenario, ...rest] = positionals;
    const own = allowed[kind ?? ""];
    if (kind === undefined || own === undefined || scenario === undefined || rest.length > 0) return undefined;
    if (!SCENARIO_ID.test(scenario)) return undefined;
    if (Object.keys(values).some((key) => key !== "root" && !own.includes(key))) return undefined;
    if (values.root !== undefined && values.root === "") return undefined;
    const base: Base = values.root === undefined ? { scenario } : { scenario, root: values.root };

    const part = parsePart(values.part);
    if (values.part !== undefined && part === undefined) return undefined;
    const range = parseRange(values.batches);
    if (values.batches !== undefined && range === undefined) return undefined;
    const batch = parseBatch(values.batch);
    if (values.batch !== undefined && batch === undefined) return undefined;

    switch (kind) {
      case "plan":
        return { ...base, kind, force: values.force ?? false };
      case "status":
        return { ...base, kind };
      case "brief":
        return part === undefined || batch === undefined ? undefined : { ...base, kind, part, batch };
      case "check":
        return { ...base, kind, ...(part === undefined ? {} : { part }), ...(range === undefined ? {} : { range }) };
      case "label-import":
        return part === undefined || batch === undefined || !values.checker || !values.file
          ? undefined
          : { ...base, kind, part, batch, checker: values.checker, file: values.file };
      case "blind-export":
      case "stale":
      case "reconcile":
        return part === undefined || range === undefined ? undefined : { ...base, kind, part, range };
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}
