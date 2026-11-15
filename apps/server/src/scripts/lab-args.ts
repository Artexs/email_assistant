import { parseArgs } from "node:util";

import { ADDRESS_PATTERN } from "@ea/core";
import { z } from "zod";

export const usage = [
  "usage:",
  "  bun run lab seed [--org lab|demo]",
  "  bun run lab reset --org lab|demo --yes",
  "  bun run lab start --mode day|week [--date YYYY-MM-DD] [--org lab|demo] [--cap-usd <n>] [--reuse]",
  "  bun run lab status [--run <id>]",
  "  bun run lab stop --run <id>",
  "  bun run lab serve",
  "  bun run lab score --run <id> [--out <dir>]",
  "  bun run lab demo-reset --yes",
  "  bun run lab demo-export --day <n> --out <file>",
  "  bun run lab demo-import --file <file> --email <address> [--replace]",
  "  Exit 0: ok. Exit 1: usage error, refusal or failure.",
].join("\n");

export type LabOrgFlag = "lab" | "demo";

export type LabCommand =
  | { kind: "seed"; org: LabOrgFlag }
  | { kind: "reset"; org: LabOrgFlag }
  | { kind: "start"; mode: "day" | "week"; date?: string; org: LabOrgFlag; capUsd?: number; reuse: boolean }
  | { kind: "status"; runId?: string }
  | { kind: "stop"; runId: string }
  | { kind: "serve" }
  | { kind: "score"; runId: string; out?: string }
  | { kind: "demo-reset" }
  | { kind: "demo-export"; day: number; out: string }
  | { kind: "demo-import"; file: string; email: string; replace: boolean };

const orgSchema = z.enum(["lab", "demo"]);
const runIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const capSchema = z.coerce.number().positive().finite();

// The flags each command takes. A flag of another command fails the parse.
const allowedFlags: Record<LabCommand["kind"], readonly string[]> = {
  seed: ["org"],
  reset: ["org", "yes"],
  start: ["mode", "date", "org", "cap-usd", "reuse"],
  status: ["run"],
  stop: ["run"],
  serve: [],
  score: ["run", "out"],
  "demo-reset": ["yes"],
  "demo-export": ["day", "out"],
  "demo-import": ["file", "email", "replace"],
};

const isKind = (value: string | undefined): value is LabCommand["kind"] =>
  value !== undefined && Object.hasOwn(allowedFlags, value);

// Returns undefined on any bad argument; the script prints the usage.
export function parseLabArgs(argv: string[]): LabCommand | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        org: { type: "string" },
        mode: { type: "string" },
        date: { type: "string" },
        "cap-usd": { type: "string" },
        reuse: { type: "boolean" },
        run: { type: "string" },
        out: { type: "string" },
        day: { type: "string" },
        file: { type: "string" },
        email: { type: "string" },
        replace: { type: "boolean" },
        yes: { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
    const kind = positionals[0];
    if (positionals.length !== 1 || !isKind(kind)) return undefined;
    const given = Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([flag]) => flag);
    if (given.some((flag) => !allowedFlags[kind].includes(flag))) return undefined;

    const org = orgSchema.safeParse(values.org ?? "lab");
    if (!org.success) return undefined;
    const runId = values.run === undefined ? undefined : runIdSchema.safeParse(values.run);
    if (runId !== undefined && !runId.success) return undefined;

    switch (kind) {
      case "seed":
        return { kind, org: org.data };
      case "reset":
        // A reset deletes data: the org must be named and `--yes` must be given.
        return values.org !== undefined && values.yes === true ? { kind, org: org.data } : undefined;
      case "start": {
        const mode = z.enum(["day", "week"]).safeParse(values.mode);
        if (!mode.success) return undefined;
        const date = values.date === undefined ? undefined : dateSchema.safeParse(values.date);
        if (date !== undefined && !date.success) return undefined;
        const cap = values["cap-usd"] === undefined ? undefined : capSchema.safeParse(values["cap-usd"]);
        if (cap !== undefined && !cap.success) return undefined;
        return {
          kind,
          mode: mode.data,
          ...(date?.success ? { date: date.data } : {}),
          org: org.data,
          ...(cap?.success ? { capUsd: cap.data } : {}),
          reuse: values.reuse === true,
        };
      }
      case "status":
        return { kind, ...(runId?.success ? { runId: runId.data } : {}) };
      case "stop":
        return runId?.success ? { kind, runId: runId.data } : undefined;
      case "serve":
        return { kind };
      case "score":
        return runId?.success
          ? { kind, runId: runId.data, ...(values.out === undefined ? {} : { out: values.out }) }
          : undefined;
      case "demo-reset":
        return values.yes === true ? { kind } : undefined;
      case "demo-export": {
        const day = z.coerce.number().int().min(1).max(7).safeParse(values.day);
        if (!day.success || values.out === undefined || values.out === "") return undefined;
        return { kind, day: day.data, out: values.out };
      }
      case "demo-import": {
        const email = z.string().trim().toLowerCase().regex(ADDRESS_PATTERN).safeParse(values.email);
        if (!email.success || values.file === undefined || values.file === "") return undefined;
        return { kind, file: values.file, email: email.data, replace: values.replace === true };
      }
    }
  } catch {
    return undefined;
  }
}
