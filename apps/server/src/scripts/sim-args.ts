import {
  type CliDescription,
  defaultFreezeFloors,
  sentFreezeFloors,
  sentParts,
  simParts,
  type SentPart,
  type SimPart,
  UsageError,
} from "@ea/core";

import { parseFlags } from "./lib/parse-flags";

export const usage = [
  "bun run sim plan <scenario> [--bank sent] [--root <dir>] [--force]",
  "       bun run sim status <scenario> [--part sent-dev|sent-holdout] [--root <dir>]",
  "       bun run sim brief <scenario> --part dev|holdout|week|sent-dev|sent-holdout --batch <NNN> [--root <dir>]",
  "       bun run sim check <scenario> [--part dev|holdout|week|sent-dev|sent-holdout] [--batches <from>-<to>] [--root <dir>]",
  "       bun run sim blind-export <scenario> --part <part> --batches <from>-<to> [--root <dir>]",
  "       bun run sim label-import <scenario> --part <part> --batch <NNN> --checker <model id> --file <path> [--root <dir>]",
  "       bun run sim stale <scenario> --part <part> --batches <from>-<to> [--root <dir>]",
  "       bun run sim reconcile <scenario> --part <part> --batches <from>-<to> [--root <dir>]",
  "       bun run sim freeze <scenario> --version <v> --date <YYYY-MM-DD> [--min-dev 50] [--min-holdout 200] [--root <dir>]",
  "       bun run sim freeze <scenario> --bank sent [--date <YYYY-MM-DD>] [--min-dev 49] [--min-holdout 245] [--root <dir>]",
  "       bun run sim audit-list <scenario> --version <v> [--root <dir>]",
  "       bun run sim audit-apply <scenario> --version <v> --date <YYYY-MM-DD> [--root <dir>]",
  "  A sent part (sent-dev, sent-holdout) runs the sent-bank form of a command; the sent bank freezes into sent-manifest.json.",
].join("\n");

export const cliDescriptions = [
  {
    name: "sim",
    summary: "Plans, checks, labels and freezes the sim corpus files of a scenario under evals/sim/.",
    risk: "write",
    needs: ["none"],
    usage,
    exits: { 1: "a refusal (a frozen part, a missing file) or an issue found in the corpus" },
    outputNote: "counts, ids and codes only",
  },
] satisfies readonly CliDescription[];

export interface BatchRange {
  from: number;
  to: number;
}

interface Base {
  scenario: string;
  // Folder that holds the corpus folders; the default is evals/sim of the repo.
  root?: string;
}

export type IncomingSimCommand =
  | (Base & { kind: "plan"; force: boolean })
  | (Base & { kind: "status" })
  | (Base & { kind: "brief"; part: SimPart; batch: number })
  | (Base & { kind: "check"; part?: SimPart; range?: BatchRange })
  | (Base & { kind: "blind-export"; part: SimPart; range: BatchRange })
  | (Base & { kind: "stale"; part: SimPart; range: BatchRange })
  | (Base & { kind: "reconcile"; part: SimPart; range: BatchRange })
  | (Base & { kind: "label-import"; part: SimPart; batch: number; checker: string; file: string })
  | (Base & { kind: "freeze"; version: string; date: string; minDev: number; minHoldout: number })
  | (Base & { kind: "audit-list"; version: string })
  | (Base & { kind: "audit-apply"; version: string; date: string });

// The sent-bank commands: the `bank: "sent"` field tells them from the incoming ones.
type SentBase = Base & { bank: "sent" };
export type SentSimCommand =
  | (SentBase & { kind: "plan"; force: boolean })
  | (SentBase & { kind: "status"; part: SentPart })
  | (SentBase & { kind: "brief"; part: SentPart; batch: number })
  | (SentBase & { kind: "check"; part: SentPart; range?: BatchRange })
  | (SentBase & { kind: "blind-export"; part: SentPart; range: BatchRange })
  | (SentBase & { kind: "stale"; part: SentPart; range: BatchRange })
  | (SentBase & { kind: "reconcile"; part: SentPart; range: BatchRange })
  | (SentBase & { kind: "label-import"; part: SentPart; batch: number; checker: string; file: string })
  // Both sent parts freeze together; the version is the next `sent-vN`, so there is no --version.
  | (SentBase & { kind: "freeze"; date?: string; minDev: number; minHoldout: number });

export type SimCommand = IncomingSimCommand | SentSimCommand;

export function isSentCommand(cmd: SimCommand): cmd is SentSimCommand {
  return "bank" in cmd;
}

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

function parseSentPart(text: string | undefined): SentPart | undefined {
  return sentParts.find((part) => part === text);
}

// Each command takes only its own flags.
const allowed: Record<string, readonly string[]> = {
  plan: ["force", "bank"],
  status: ["part"],
  brief: ["part", "batch"],
  check: ["part", "batches"],
  "blind-export": ["part", "batches"],
  "label-import": ["part", "batch", "checker", "file"],
  stale: ["part", "batches"],
  reconcile: ["part", "batches"],
  freeze: ["version", "date", "min-dev", "min-holdout", "bank"],
  "audit-list": ["version"],
  "audit-apply": ["version", "date"],
};

const VERSION = /^\d+(\.\d+)?$/;
// The flags of the sent-bank freeze.
const sentFreezeFlags = ["bank", "date", "min-dev", "min-holdout"];

function parseDate(text: string | undefined): string | undefined {
  if (text === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? undefined : text;
}

function parseCount(text: string | undefined, fallback: number): number | undefined {
  if (text === undefined) return fallback;
  return /^\d{1,5}$/.test(text) ? Number(text) : undefined;
}

interface SentInput {
  base: Base;
  kind: string;
  sentBank: boolean;
  sentPart: SentPart | undefined;
  values: {
    force?: boolean | undefined;
    checker?: string | undefined;
    file?: string | undefined;
    date?: string | undefined;
  };
  range: BatchRange | undefined;
  batch: number | undefined;
  date: string | undefined;
  minDev: number | undefined;
  minHoldout: number | undefined;
}

// The sent-bank commands: `--bank sent` (plan, freeze) or a sent `--part` (the others).
function parseSent(input: SentInput): SentSimCommand | undefined {
  const { kind, sentBank, sentPart: part, values, range, batch, date, minDev, minHoldout } = input;
  const base: SentBase = { ...input.base, bank: "sent" };
  if (sentBank) {
    if (kind === "plan") return { ...base, kind, force: values.force ?? false };
    if (kind !== "freeze" || minDev === undefined || minHoldout === undefined) return undefined;
    if (values.date !== undefined && date === undefined) return undefined;
    return { ...base, kind, ...(date === undefined ? {} : { date }), minDev, minHoldout };
  }
  // A sent part belongs to the sent form of the commands that take a part.
  if (part === undefined) return undefined;
  switch (kind) {
    case "status":
      return { ...base, kind, part };
    case "brief":
      return batch === undefined ? undefined : { ...base, kind, part, batch };
    case "check":
      return { ...base, kind, part, ...(range === undefined ? {} : { range }) };
    case "label-import":
      return batch === undefined || !values.checker || !values.file
        ? undefined
        : { ...base, kind, part, batch, checker: values.checker, file: values.file };
    case "blind-export":
    case "stale":
    case "reconcile":
      return range === undefined ? undefined : { ...base, kind, part, range };
    default:
      return undefined;
  }
}

// Throws `UsageError` on any bad argument; `runCli` prints the usage.
export function parseSimArgs(argv: string[]): SimCommand {
  const cmd = parseSimCommand(argv);
  if (cmd === undefined) throw new UsageError("bad or missing sim command or option");
  return cmd;
}

// Undefined on a bad value or a bad combination; an unknown flag throws `UsageError`.
function parseSimCommand(argv: string[]): SimCommand | undefined {
  const { values, positionals } = parseFlags({
    args: argv,
    options: {
      root: { type: "string" },
      force: { type: "boolean" },
      part: { type: "string" },
      batch: { type: "string" },
      batches: { type: "string" },
      checker: { type: "string" },
      file: { type: "string" },
      version: { type: "string" },
      date: { type: "string" },
      "min-dev": { type: "string" },
      "min-holdout": { type: "string" },
      bank: { type: "string" },
    },
    allowPositionals: true,
  });
  const [kind, scenario, ...rest] = positionals;
  if (values.bank !== undefined && values.bank !== "sent" && values.bank !== "incoming") return undefined;
  const sentBank = values.bank === "sent";
  const own = kind === "freeze" && sentBank ? sentFreezeFlags : allowed[kind ?? ""];
  if (kind === undefined || own === undefined || scenario === undefined || rest.length > 0) return undefined;
  if (!SCENARIO_ID.test(scenario)) return undefined;
  if (Object.keys(values).some((key) => key !== "root" && !own.includes(key))) return undefined;
  if (values.root !== undefined && values.root === "") return undefined;
  const base: Base = values.root === undefined ? { scenario } : { scenario, root: values.root };

  const part = parsePart(values.part);
  const sentPart = parseSentPart(values.part);
  if (values.part !== undefined && part === undefined && sentPart === undefined) return undefined;
  const range = parseRange(values.batches);
  if (values.batches !== undefined && range === undefined) return undefined;
  const batch = parseBatch(values.batch);
  if (values.batch !== undefined && batch === undefined) return undefined;

  const version = values.version !== undefined && VERSION.test(values.version) ? values.version : undefined;
  const date = parseDate(values.date);
  const floors = sentBank ? sentFreezeFloors : defaultFreezeFloors;
  const minDev = parseCount(values["min-dev"], floors.minDev);
  const minHoldout = parseCount(values["min-holdout"], floors.minHoldout);

  if (sentBank || sentPart !== undefined) {
    return parseSent({ base, kind, sentBank, sentPart, values, range, batch, date, minDev, minHoldout });
  }
  switch (kind) {
    case "freeze":
      return version === undefined || date === undefined || minDev === undefined || minHoldout === undefined
        ? undefined
        : { ...base, kind, version, date, minDev, minHoldout };
    case "audit-list":
      return version === undefined ? undefined : { ...base, kind, version };
    case "audit-apply":
      return version === undefined || date === undefined ? undefined : { ...base, kind, version, date };
    case "plan":
      return { ...base, kind, force: values.force ?? false };
    case "status":
      // Only a sent part shows a part status.
      return part === undefined ? { ...base, kind } : undefined;
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
}
