import { parseArgs } from "node:util";

import {
  type CliDescription,
  llmEffortLevels,
  type SentPart,
  sentParts,
  type SimPart,
  simParts,
  UsageError,
} from "@ea/core";
import { z } from "zod";

import {
  type ClassifierPromptChoice,
  type ClassifierVersion,
  type ClassifierPart,
  classifierParts,
  classifierV3Parts,
  classifierVersionIds,
  type DrafterVersion,
  drafterVersionIds,
  type JudgeVersion,
  judgeVersionIds,
  optionalParts,
  productionClassifierChoice,
  type StylistVersion,
  stylistVersionIds,
  versionHasParts,
} from "../modules/triage";
import { RUN_CAP_USD } from "../platform/eval-ledger";
import { llmProviderIds } from "../platform/llm";

import { stylistArgsValid, STYLE_INJECTION_SET } from "./eval-args-stylist";
import { parseFlags } from "./lib/parse-flags";

const sets = ["synthetic", "injection", "delegation", "all"] as const;
// `reply-injection` and `reply-commitment` are the sets of the drafter run (`--drafter`); the classifier run takes
// neither of them.
const replySets = ["reply-injection", "reply-commitment"] as const;
// `style-injection` is the set of the stylist run (`--stylist`); no other run takes it.
const drafterSets = [...sets, ...replySets, STYLE_INJECTION_SET] as const;
export type ReplySet = (typeof replySets)[number];

// The bare `--sim` command meets the 10 minute exit: 1,417 calls at 240 per minute take about 6 minutes.
export const SIM_DEFAULT_CONCURRENCY = 8;
export const SIM_DEFAULT_RPM = 240;

const ids = llmProviderIds.join("|");

export const evalUsage = [
  `bun run eval [--provider ${ids}] [--model <id>] [--reasoning-effort <value>] [--set synthetic|injection|delegation|all] [--bar 0.98] [--min-kept 30]`,
  "                    [--retries 4] [--limit n] [--per-category n] [--state <file.jsonl>] [--fresh]",
  "                    [--out <file.md>]",
  "       bun run eval --real --org-id <uuid> --mailbox-id <uuid> [--synthetic] [--model <id>] [--bar 0.98] [--min-kept 30]",
  "                    [--json-out <file>] [--out <file.md>]",
  "       bun run eval --gap --sim-json <gate file> --real-json <file> [--out <file.md>]",
  "       bun run eval --sim <scenario> --part dev|holdout|week [--provider …] [--model …] [--reasoning-effort …]",
  `                    [--concurrency <n, default ${SIM_DEFAULT_CONCURRENCY}>] [--rpm <n, default ${SIM_DEFAULT_RPM}>] [--budget-usd 1]`,
  "                    [--spend-ledger <file>] [--fresh] [--fresh-lock] [--retries 4] [--limit n] [--out <file.md>]",
  "                    [--prompt-version classifier-v2|classifier-v3|classifier-v4 (default: the production prompt)]",
  "                    [--prompt-parts urgency,history,list,profile|none (only with classifier-v3 or classifier-v4; profile only with classifier-v4; none = attachments only; default: the production parts when v3 is in production, else none)]",
  "                    (the history part gives the model the sim's generated received count and corrections: the persona group's ideal mix, not the model's own past labels)",
  `                    [--judge [--judge-provider ${ids}] [--judge-model <id>] [--judge-rpm <n>]]`,
  "       (--provider sets every role of the run, the judge too; --judge-provider then moves only the judge; --model and --reasoning-effort pin the judged role; --judge-model pins the judge; default judge: the strong tier of the provider)",
  "       bun run eval --sim <scenario> --part dev|holdout|week --suspicious [--out <file.md>]   (suspicious-mail rules, no LLM)",
  "       bun run eval --sim <scenario> --part sent-dev|sent-holdout --extractor [--provider …] [--model …] [--reasoning-effort …]",
  `                    [--concurrency <n, default ${SIM_DEFAULT_CONCURRENCY}>] [--rpm <n, default ${SIM_DEFAULT_RPM}>] [--budget-usd 1]`,
  "                    [--spend-ledger <file>] [--fresh] [--fresh-lock] [--retries 4] [--limit n] [--out <file.md>]",
  "                    (the open-loops extractor on the sent-mail bank; the part sent-holdout needs --extractor, and --extractor needs a sent part)",
  "       bun run eval --sim <scenario> --part dev|holdout|week --drafter [--model …] [--reasoning-effort …] [--limit n] [--out <file.md>]",
  "       bun run eval --set reply-injection|reply-commitment --drafter --judge [--model …] [--out <file.md>]",
  `                    [--drafter-prompt ${drafterVersionIds.join("|")} (default: the production prompt)] [--dump-drafts <file.jsonl> (only with --part dev|week or --set reply-commitment)]`,
  `                    [--judge-prompt ${judgeVersionIds.join("|")} (with --judge; default: the current judge prompt)] [--style none|scenario|<style file> (default scenario; the gate file needs scenario)]`,
  `                    [--concurrency <n, default ${SIM_DEFAULT_CONCURRENCY}>] [--rpm <n, default ${SIM_DEFAULT_RPM}>] [--budget-usd 1] [--spend-ledger <file>] [--fresh] [--fresh-lock] [--retries 4]`,
  `                    [--judge [--judge-provider ${ids}] [--judge-model <id>] [--judge-rpm <n>]]`,
  "                    (the reply drafter on the needs_reply cases of an incoming part, or on the reply injection set; --provider sets every role, --model picks the drafter model; the judge model must differ from the drafter model (default judge: the strong tier of the provider); the injection set needs --judge)",
  `       bun run eval --sim <scenario> --part sent-dev|sent-holdout --stylist [--stylist-prompt ${stylistVersionIds.join("|")} (default: the production prompt)] [--provider …] [--model …] [--reasoning-effort …]`,
  "                    [--budget-usd 1] [--spend-ledger <file>] [--out <file.md>]   (the style suggestion on the sent mail of the part; writes the report and the style file in evals/results/styles/)",
  "       bun run eval --set style-injection --stylist [--stylist-prompt …] [--provider …] [--model …] [--reasoning-effort …] [--budget-usd 1] [--spend-ledger <file>] [--out <file.md>]",
  "                    (the 4 injection cases of the stylist; writes the report and the injection result file in evals/results/styles/)",
].join("\n");

export const cliDescriptions = [
  {
    name: "eval",
    summary: "Runs an eval of the classifier, the drafter, the extractor or the stylist and prints a report.",
    risk: "cost",
    needs: ["db", "llm"],
    usage: evalUsage,
    exits: {
      1: "a check or a gate failed, a key or a price is missing, or a run has too many error cases",
      3: "the database or the LLM provider did not answer",
      4: "stopped at the budget cap or the error limit; run the same command again",
    },
    outputNote: "counts and category names only; a holdout run prints no case id",
  },
] satisfies readonly CliDescription[];

const optionsSchema = z.object({
  provider: z.enum(llmProviderIds).optional(),
  model: z.string().min(1).optional(),
  "reasoning-effort": z.enum(llmEffortLevels).optional(),
  set: z.enum(drafterSets).default("all"),
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
  "json-out": z.string().min(1).optional(),
  gap: z.boolean().default(false),
  "sim-json": z.string().min(1).optional(),
  "real-json": z.string().min(1).optional(),
  "org-id": z.uuid().optional(),
  "mailbox-id": z.uuid().optional(),
  sim: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  // `dev|holdout|week` of the incoming bank, or a part of the sent bank (only with `--extractor`).
  part: z.enum([...simParts, ...sentParts]).optional(),
  concurrency: z.coerce.number().int().min(1).max(64).optional(),
  rpm: z.coerce.number().positive().optional(),
  "budget-usd": z.coerce.number().positive().optional(),
  "spend-ledger": z.string().min(1).optional(),
  "fresh-lock": z.boolean().default(false),
  suspicious: z.boolean().default(false),
  extractor: z.boolean().default(false),
  drafter: z.boolean().default(false),
  stylist: z.boolean().default(false),
  "stylist-prompt": z.enum(stylistVersionIds as [StylistVersion, ...StylistVersion[]]).optional(),
  "prompt-version": z.enum(classifierVersionIds as [ClassifierVersion, ...ClassifierVersion[]]).optional(),
  "prompt-parts": z.string().min(1).optional(),
  "drafter-prompt": z.enum(drafterVersionIds as [DrafterVersion, ...DrafterVersion[]]).optional(),
  "dump-drafts": z.string().min(1).optional(),
  "judge-prompt": z.enum(judgeVersionIds as [JudgeVersion, ...JudgeVersion[]]).optional(),
  style: z.string().min(1).optional(),
  judge: z.boolean().default(false),
  "judge-provider": z.enum(llmProviderIds).optional(),
  "judge-model": z.string().min(1).optional(),
  "judge-rpm": z.coerce.number().positive().optional(),
});

export type EvalOptions = Omit<z.infer<typeof optionsSchema>, "part" | "json-out"> & {
  // `--json-out <file>`: the counts of a `--real` run.
  jsonOut?: string;
  // The part of the incoming bank. Undefined in an extractor run.
  part?: SimPart;
  // The part of the sent bank. Set only in an extractor run.
  sentPart?: SentPart;
  // The old command runs one case at a time and keeps the configured rpm (`rpm` undefined).
  concurrency: number;
  budgetUsd: number;
  // The classifier prompt of the run. Only a sim run picks another one than production.
  prompt: ClassifierPromptChoice;
};

// --real reads labels from the DB and takes no case-run options; the case run takes no DB options.
const realOnly = ["org-id", "mailbox-id", "synthetic", "json-out"] as const;
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
// The drafter options belong to `--drafter` only.
const drafterOnly = ["drafter-prompt", "dump-drafts", "judge-prompt", "style"] as const;
const stylistOnly = ["stylist", "stylist-prompt"] as const;
const simExcluded = [
  "real",
  "gap",
  ...gapOnly,
  "set",
  "per-category",
  "state",
  ...realOnly,
  ...drafterOnly,
  ...stylistOnly,
] as const;
// The options of `--sim <scenario> --part sent-dev|sent-holdout --extractor`.
const extractorAllowed = new Set<string>([
  "sim",
  "part",
  "extractor",
  "provider",
  "model",
  "reasoning-effort",
  "concurrency",
  "rpm",
  "budget-usd",
  "spend-ledger",
  "fresh",
  "fresh-lock",
  "retries",
  "limit",
  "out",
]);
// The options of a drafter run: `--sim <scenario> --part dev|holdout|week` or `--set reply-injection|reply-commitment`.
const drafterAllowed = new Set<string>([
  ...extractorAllowed,
  "drafter",
  "set",
  "judge",
  "judge-provider",
  "judge-model",
  "judge-rpm",
  ...drafterOnly,
]);
const simOnly = [
  "extractor",
  "drafter",
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
  ...drafterOnly,
  ...stylistOnly,
] as const;

const isSentPart = (value: string): value is SentPart => (sentParts as readonly string[]).includes(value);

// `none` is attachments only. Undefined means a usage error: an empty or unknown name, or `none` with a name.
function parsePromptParts(text: string, version: ClassifierVersion): ClassifierPart[] | undefined {
  const names = text.split(",").map((name) => name.trim());
  if (names.length === 1 && names[0] === "none") return [];
  // v3 has no `profile`.
  const known = new Set<string>(version === "classifier-v4" ? classifierParts : classifierV3Parts);
  if (!names.every((name) => known.has(name))) return undefined;
  return optionalParts(names as ClassifierPart[]);
}

// Without `--prompt-parts`, v3 runs the production parts when v3 is the production pointer, else `none`.
export function resolvePrompt(
  version: ClassifierVersion | undefined,
  partsText: string | undefined,
  production: ClassifierPromptChoice = productionClassifierChoice()
): ClassifierPromptChoice | undefined {
  const chosen = version ?? production.version;
  if (partsText === undefined) return chosen === production.version ? production : { version: chosen, parts: [] };
  if (!versionHasParts(chosen)) return undefined;
  const parts = parsePromptParts(partsText, chosen);
  return parts === undefined ? undefined : { version: chosen, parts };
}

type ParsedData = Omit<z.infer<typeof optionsSchema>, "part" | "json-out"> & {
  jsonOut?: string;
  part?: SimPart;
  sentPart?: SentPart;
};

// `--drafter` runs the reply drafter on `--sim <scenario> --part dev|holdout|week` or on `--set reply-injection` or
// `--set reply-commitment`; any other combination is a usage error. The two sets have no corpus and always need the judge.
function parseDrafterArgs(data: ParsedData, values: Record<string, unknown>): EvalOptions | undefined {
  if (data.extractor || data.suspicious || data.real || data.gap) return undefined;
  if (Object.keys(values).some((key) => !drafterAllowed.has(key))) return undefined;
  if (!data.judge && (data["judge-provider"] || data["judge-model"] || data["judge-rpm"] || data["judge-prompt"]))
    return undefined;
  const sim = data.sim !== undefined;
  const set = (replySets as readonly string[]).includes(data.set);
  // Exactly one source: a corpus part (never a sent part) or one reply set.
  if (sim === set) return undefined;
  if (sim && (data.part === undefined || data.sentPart !== undefined || values.set !== undefined)) return undefined;
  if (set && (data.part !== undefined || data.sentPart !== undefined || !data.judge)) return undefined;
  // Draft texts leave the run only for made-up tuning data: the dev and week parts and the dev-only commitment set.
  // The holdout stays unread; the injection set is a bar, not tuning data.
  const dumpAllowed = data.part === "dev" || data.part === "week" || data.set === "reply-commitment";
  if (data["dump-drafts"] !== undefined && !dumpAllowed) return undefined;
  return {
    ...data,
    prompt: productionClassifierChoice(),
    concurrency: data.concurrency ?? SIM_DEFAULT_CONCURRENCY,
    rpm: data.rpm ?? SIM_DEFAULT_RPM,
    budgetUsd: data["budget-usd"] ?? RUN_CAP_USD,
  };
}

// `--stylist` runs the style suggestion on `--sim <scenario> --part sent-dev|sent-holdout` or on `--set style-injection`;
// any other combination, `--judge` and `--drafter` included, is a usage error.
function parseStylistArgs(data: ParsedData, values: Record<string, unknown>): EvalOptions | undefined {
  if (!stylistArgsValid(data, values)) return undefined;
  return {
    ...data,
    prompt: productionClassifierChoice(),
    concurrency: 1,
    budgetUsd: data["budget-usd"] ?? RUN_CAP_USD,
  };
}

// `--json <file>` became `--json-out <file>`: name the new flag instead of a bare unknown option.
const RENAMED_JSON = /^--json(=|$)/;

// Throws `UsageError` for an unknown flag, a bad value or a combination of options that no mode takes.
export function parseEvalArgs(args: string[]): EvalOptions {
  if (args.slice(0, args.includes("--") ? args.indexOf("--") : args.length).some((arg) => RENAMED_JSON.test(arg))) {
    throw new UsageError("--json is now --json-out <file>");
  }
  const options = parseEvalOptions(args);
  if (options === undefined) throw new UsageError("bad value or conflicting options");
  return options;
}

// Undefined means a usage error.
function parseEvalOptions(args: string[]): EvalOptions | undefined {
  const { values } = parseFlags({
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
      "json-out": { type: "string" },
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
      extractor: { type: "boolean" },
      drafter: { type: "boolean" },
      stylist: { type: "boolean" },
      "stylist-prompt": { type: "string" },
      judge: { type: "boolean" },
      "judge-provider": { type: "string" },
      "judge-model": { type: "string" },
      "judge-rpm": { type: "string" },
      "prompt-version": { type: "string" },
      "prompt-parts": { type: "string" },
      "drafter-prompt": { type: "string" },
      "dump-drafts": { type: "string" },
      "judge-prompt": { type: "string" },
      style: { type: "string" },
    },
  });
  const parsed = optionsSchema.safeParse(values);
  if (!parsed.success) return undefined;
  const { "json-out": jsonOut, ...rest } = parsed.data;
  const rawPart = rest.part;
  const sentPart = rawPart !== undefined && isSentPart(rawPart) ? rawPart : undefined;
  const data = {
    ...rest,
    ...(jsonOut === undefined ? {} : { jsonOut }),
    part: sentPart === undefined ? (rawPart as SimPart | undefined) : undefined,
    sentPart,
  };
  if (data.gap) {
    const allowed = new Set<string>(["gap", "out", ...gapOnly]);
    if (Object.keys(values).some((key) => !allowed.has(key))) return undefined;
    if (data["sim-json"] === undefined || data["real-json"] === undefined) return undefined;
    return { ...data, concurrency: 1, budgetUsd: RUN_CAP_USD, prompt: productionClassifierChoice() };
  }
  if (gapOnly.some((key) => values[key] !== undefined)) return undefined;
  if (data.stylist) return parseStylistArgs(data, values);
  if (data.drafter) return parseDrafterArgs(data, values);
  if ((replySets as readonly string[]).includes(data.set) || data.set === STYLE_INJECTION_SET) return undefined;
  if (data.extractor || data.sentPart !== undefined) {
    // A sent part runs only with --extractor and the other way round; the classifier options mean nothing here.
    if (data.sim === undefined || data.sentPart === undefined || !data.extractor) return undefined;
    if (Object.keys(values).some((key) => !extractorAllowed.has(key))) return undefined;
    return {
      ...data,
      prompt: productionClassifierChoice(),
      concurrency: data.concurrency ?? SIM_DEFAULT_CONCURRENCY,
      rpm: data.rpm ?? SIM_DEFAULT_RPM,
      budgetUsd: data["budget-usd"] ?? RUN_CAP_USD,
    };
  }
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
    const prompt = resolvePrompt(data["prompt-version"], data["prompt-parts"]);
    if (prompt === undefined) return undefined;
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
  return wrong ? undefined : { ...data, concurrency: 1, budgetUsd: RUN_CAP_USD, prompt: productionClassifierChoice() };
}
