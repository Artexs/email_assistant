import { parseArgs } from "node:util";

import { simParts } from "@ea/core";
import { z } from "zod";

import {
  type ClassifierPromptChoice,
  type ClassifierVersion,
  type ClassifierV3Part,
  classifierV3Parts,
  classifierVersionIds,
  optionalParts,
  productionClassifierChoice,
  prompts,
} from "../modules/triage";
import { openAiReasoningEfforts } from "../platform/config";
import { RUN_CAP_USD } from "../platform/eval-ledger";
import { llmProviderIds } from "../platform/llm";

const v3Version: ClassifierVersion = "classifier-v3";
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
  "                    [--prompt-version classifier-v2|classifier-v3 (default: the production prompt)]",
  "                    [--prompt-parts urgency,history,list|none (only with classifier-v3; none = attachments only; default: the production parts when v3 is in production, else none)]",
  "                    (the history part gives the model the sim's generated received count and corrections: the persona group's ideal mix, not the model's own past labels)",
  "                    [--escalate [--escalation-model <id>] [--escalation-reasoning-effort <value>] (a second call by the escalation role for person mail answered info, notification, spam or unsure; the report shows the cascade)]",
  "                    [--judge [--judge-provider gemini|openai] [--judge-model <id>] [--judge-rpm <n>]]",
  "       bun run eval --sim <scenario> --part dev|holdout|week --suspicious [--out <file.md>]   (suspicious-mail rules, no LLM)",
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
  suspicious: z.boolean().default(false),
  "prompt-version": z.enum(classifierVersionIds as [ClassifierVersion, ...ClassifierVersion[]]).optional(),
  "prompt-parts": z.string().min(1).optional(),
  escalate: z.boolean().default(false),
  "escalation-model": z.string().min(1).optional(),
  "escalation-reasoning-effort": z.enum(openAiReasoningEfforts).optional(),
  judge: z.boolean().default(false),
  "judge-provider": z.enum(llmProviderIds).optional(),
  "judge-model": z.string().min(1).optional(),
  "judge-rpm": z.coerce.number().positive().optional(),
});

export type EvalOptions = z.infer<typeof optionsSchema> & {
  // The old command runs one case at a time and keeps the configured rpm (`rpm` undefined).
  concurrency: number;
  budgetUsd: number;
  // The classifier prompt of the run. Only a sim run picks another one than production.
  prompt: ClassifierPromptChoice;
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
const simOnly = [
  "part",
  "suspicious",
  "concurrency",
  "rpm",
  "budget-usd",
  "spend-ledger",
  "fresh-lock",
  "judge",
  "judge-provider",
  "judge-model",
  "judge-rpm",
  "prompt-version",
  "prompt-parts",
  "escalate",
  "escalation-model",
  "escalation-reasoning-effort",
] as const;

// `none` is attachments only. Undefined means a usage error: an empty or unknown name, or `none` with a name.
function parsePromptParts(text: string): ClassifierV3Part[] | undefined {
  const names = text.split(",").map((name) => name.trim());
  if (names.length === 1 && names[0] === "none") return [];
  const known = new Set<string>(classifierV3Parts);
  if (!names.every((name) => known.has(name))) return undefined;
  return optionalParts(names as ClassifierV3Part[]);
}

// Review N5: without `--prompt-parts`, v3 runs the production parts when v3 is the production pointer, else `none`.
export function resolvePrompt(
  version: ClassifierVersion | undefined,
  partsText: string | undefined,
  production: ClassifierPromptChoice = productionClassifierChoice()
): ClassifierPromptChoice | undefined {
  const chosen = version ?? production.version;
  if (partsText === undefined) return chosen === production.version ? production : { version: chosen, parts: [] };
  if (chosen !== v3Version) return undefined;
  const parts = parsePromptParts(partsText);
  return parts === undefined ? undefined : { version: chosen, parts };
}

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
        suspicious: { type: "boolean" },
        escalate: { type: "boolean" },
        "escalation-model": { type: "string" },
        "escalation-reasoning-effort": { type: "string" },
        judge: { type: "boolean" },
        "judge-provider": { type: "string" },
        "judge-model": { type: "string" },
        "judge-rpm": { type: "string" },
        "prompt-version": { type: "string" },
        "prompt-parts": { type: "string" },
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
      return { ...data, concurrency: 1, budgetUsd: RUN_CAP_USD, prompt: productionClassifierChoice() };
    }
    if (gapOnly.some((key) => values[key] !== undefined)) return undefined;
    if (data.suspicious) {
      // The rules need no provider, model, judge or spend option: any other option is a usage error.
      const allowed = new Set<string>(["sim", "part", "suspicious", "out"]);
      if (data.sim === undefined || data.part === undefined) return undefined;
      if (Object.keys(values).some((key) => !allowed.has(key))) return undefined;
      return { ...data, concurrency: 1, budgetUsd: RUN_CAP_USD, prompt: productionClassifierChoice() };
    }
    if (data.sim !== undefined) {
      if (data.part === undefined) return undefined;
      if (simExcluded.some((key) => values[key] !== undefined)) return undefined;
      // The judge overrides mean nothing without the judge.
      if (
        !data.judge &&
        (data["judge-provider"] !== undefined || data["judge-model"] !== undefined || data["judge-rpm"] !== undefined)
      ) {
        return undefined;
      }
      // The escalation overrides mean nothing without the escalation.
      if (
        !data.escalate &&
        (data["escalation-model"] !== undefined || data["escalation-reasoning-effort"] !== undefined)
      ) {
        return undefined;
      }
      const prompt = resolvePrompt(data["prompt-version"], data["prompt-parts"]);
      if (prompt === undefined) return undefined;
      // The second call always uses the text of the escalation base version. A first call on another version, or on
      // `--prompt-parts`, would mix two prompts, so the run measures nothing (F109 stage 12 review, stage 13).
      if (data.escalate && (data["prompt-parts"] !== undefined || prompt.version !== prompts.escalation.base)) {
        return undefined;
      }
      return {
        ...data,
        prompt,
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
    return wrong
      ? undefined
      : { ...data, concurrency: 1, budgetUsd: RUN_CAP_USD, prompt: productionClassifierChoice() };
  } catch {
    return undefined;
  }
}
