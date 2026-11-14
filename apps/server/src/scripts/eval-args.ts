import { parseArgs } from "node:util";

import { simParts } from "@ea/core";
import { z } from "zod";

import { openAiReasoningEfforts } from "../platform/config";
import { llmProviderIds } from "../platform/llm";

import { RUN_CAP_USD } from "./eval-ledger";

const sets = ["synthetic", "injection", "delegation", "all"] as const;

// The bare `--sim` command meets the 10 minute exit: 1,417 calls at 240 per minute take about 6 minutes.
export const SIM_DEFAULT_CONCURRENCY = 8;
export const SIM_DEFAULT_RPM = 240;

export const evalUsage = [
  "usage: bun run eval [--provider gemini|openai] [--model <id>] [--reasoning-effort <value>] [--set synthetic|injection|delegation|all] [--bar 0.98] [--min-kept 30]",
  "                    [--retries 4] [--limit n] [--per-category n] [--state <file.jsonl>] [--fresh]",
  "                    [--out <file.md>]",
  "       bun run eval --real --org-id <uuid> --mailbox-id <uuid> [--synthetic] [--model <id>] [--bar 0.98] [--min-kept 30]",
  "                    [--json <file>] [--out <file.md>]",
  "       bun run eval --gap --sim-json <gate file> --real-json <file> [--out <file.md>]",
  "       bun run eval --sim <scenario> --part dev|holdout|week [--provider …] [--model …] [--reasoning-effort …]",
  `                    [--concurrency <n, default ${SIM_DEFAULT_CONCURRENCY}>] [--rpm <n, default ${SIM_DEFAULT_RPM}>] [--budget-usd 1]`,
  "                    [--spend-ledger <file>] [--fresh] [--fresh-lock] [--retries 4] [--limit n] [--out <file.md>]",
].join("\n");

const optionsSchema = z.object({
  provider: z.enum(llmProviderIds).optional(),
  model: z.string().min(1).optional(),
  "reasoning-effort": z.enum(openAiReasoningEfforts).optional(),
  set: z.enum(sets).default("all"),
  bar: z.coerce.number().min(0).max(1).default(0.98),
  "min-kept": z.coerce.number().int().positive().default(30),
  retries: z.coerce.number().int().min(0).default(4),
  limit: z.coerce.number().int().positive().optional(),
  "per-category": z.coerce.number().int().positive().optional(),
  state: z.string().min(1).optional(),
  fresh: z.boolean().default(false),
  out: z.string().min(1).optional(),
  real: z.boolean().default(false),
  synthetic: z.boolean().default(false),
  json: z.string().min(1).optional(),
  gap: z.boolean().default(false),
  "sim-json": z.string().min(1).optional(),
  "real-json": z.string().min(1).optional(),
  "org-id": z.uuid().optional(),
  "mailbox-id": z.uuid().optional(),
  sim: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  part: z.enum(simParts).optional(),
  concurrency: z.coerce.number().int().min(1).max(64).optional(),
  rpm: z.coerce.number().positive().optional(),
  "budget-usd": z.coerce.number().positive().optional(),
  "spend-ledger": z.string().min(1).optional(),
  "fresh-lock": z.boolean().default(false),
});

export type EvalOptions = z.infer<typeof optionsSchema> & {
  // The old command runs one case at a time and keeps the configured rpm (`rpm` undefined).
  concurrency: number;
  budgetUsd: number;
};

// --real reads labels from the DB and takes no case-run options; the case run takes no DB options.
const realOnly = ["org-id", "mailbox-id", "synthetic", "json"] as const;
// --gap reads two files: no DB, no LLM, no case-run option. Only --out stays.
const gapOnly = ["sim-json", "real-json"] as const;
const casesOnly = [
  "provider",
  "reasoning-effort",
  "set",
  "retries",
  "limit",
  "per-category",
  "state",
  "fresh",
] as const;
// A sim run takes its set and state file from the corpus, and has no DB.
const simExcluded = ["real", "gap", ...gapOnly, "set", "per-category", "state", ...realOnly] as const;
const simOnly = ["part", "concurrency", "rpm", "budget-usd", "spend-ledger", "fresh-lock"] as const;

// Undefined means a usage error.
export function parseEvalArgs(args: string[]): EvalOptions | undefined {
  try {
    const { values } = parseArgs({
      args,
      options: {
        provider: { type: "string" },
        model: { type: "string" },
        "reasoning-effort": { type: "string" },
        set: { type: "string" },
        bar: { type: "string" },
        "min-kept": { type: "string" },
        retries: { type: "string" },
        limit: { type: "string" },
        "per-category": { type: "string" },
        state: { type: "string" },
        fresh: { type: "boolean" },
        out: { type: "string" },
        real: { type: "boolean" },
        synthetic: { type: "boolean" },
        json: { type: "string" },
        gap: { type: "boolean" },
        "sim-json": { type: "string" },
        "real-json": { type: "string" },
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        sim: { type: "string" },
        part: { type: "string" },
        concurrency: { type: "string" },
        rpm: { type: "string" },
        "budget-usd": { type: "string" },
        "spend-ledger": { type: "string" },
        "fresh-lock": { type: "boolean" },
      },
      strict: true,
    });
    const parsed = optionsSchema.safeParse(values);
    if (!parsed.success) return undefined;
    const data = parsed.data;
    if (data.gap) {
      const allowed = new Set<string>(["gap", "out", ...gapOnly]);
      if (Object.keys(values).some((key) => !allowed.has(key))) return undefined;
      if (data["sim-json"] === undefined || data["real-json"] === undefined) return undefined;
      return { ...data, concurrency: 1, budgetUsd: RUN_CAP_USD };
    }
    if (gapOnly.some((key) => values[key] !== undefined)) return undefined;
    if (data.sim !== undefined) {
      if (data.part === undefined) return undefined;
      if (simExcluded.some((key) => values[key] !== undefined)) return undefined;
      return {
        ...data,
        concurrency: data.concurrency ?? SIM_DEFAULT_CONCURRENCY,
        rpm: data.rpm ?? SIM_DEFAULT_RPM,
        budgetUsd: data["budget-usd"] ?? RUN_CAP_USD,
      };
    }
    if (simOnly.some((key) => values[key] !== undefined)) return undefined;
    const wrong = data.real
      ? casesOnly.some((key) => values[key] !== undefined) ||
        data["org-id"] === undefined ||
        data["mailbox-id"] === undefined
      : realOnly.some((key) => values[key] !== undefined);
    return wrong ? undefined : { ...data, concurrency: 1, budgetUsd: RUN_CAP_USD };
  } catch {
    return undefined;
  }
}
