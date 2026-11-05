import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { type EvalCase, evalCaseSchema } from "@ea/core";
import { z } from "zod";

import { buildRealReport, evalExitCode, listLabeledResults, renderEvalReport, runEval } from "../modules/triage";
import { classifierModel, loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { createLlmClient, LlmConfigError } from "../platform/llm";
import { createLog } from "../platform/log";

const log = createLog("eval");

const casesDir = resolve(import.meta.dir, "../../../../evals/cases");
const sets = ["synthetic", "injection", "all"] as const;

const usage = [
  "usage: bun run eval [--model <id>] [--set synthetic|injection|all] [--bar 0.98] [--min-kept 30]",
  "                    [--retries 4] [--limit n] [--out <file.md>]",
  "       bun run eval --real --org-id <uuid> --mailbox-id <uuid> [--synthetic] [--bar 0.98] [--min-kept 30]",
  "                    [--out <file.md>]",
].join("\n");

const optionsSchema = z.object({
  model: z.string().min(1).optional(),
  set: z.enum(sets).default("all"),
  bar: z.coerce.number().min(0).max(1).default(0.98),
  "min-kept": z.coerce.number().int().positive().default(30),
  retries: z.coerce.number().int().min(0).default(4),
  limit: z.coerce.number().int().positive().optional(),
  out: z.string().min(1).optional(),
  real: z.boolean().default(false),
  synthetic: z.boolean().default(false),
  "org-id": z.uuid().optional(),
  "mailbox-id": z.uuid().optional(),
});

// --real reads labels from the DB and takes no case-run options; the case run takes no DB options.
const realOnly = ["org-id", "mailbox-id", "synthetic"] as const;
const casesOnly = ["model", "set", "retries", "limit"] as const;

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        model: { type: "string" },
        set: { type: "string" },
        bar: { type: "string" },
        "min-kept": { type: "string" },
        retries: { type: "string" },
        limit: { type: "string" },
        out: { type: "string" },
        real: { type: "boolean" },
        synthetic: { type: "boolean" },
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
      },
      strict: true,
    });
    const parsed = optionsSchema.safeParse(values);
    if (!parsed.success) return undefined;
    const wrong = parsed.data.real
      ? casesOnly.some((key) => values[key] !== undefined) ||
        parsed.data["org-id"] === undefined ||
        parsed.data["mailbox-id"] === undefined
      : realOnly.some((key) => values[key] !== undefined);
    return wrong ? undefined : parsed.data;
  } catch {
    return undefined;
  }
}

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function loadCases(file: string): EvalCase[] {
  return z.array(evalCaseSchema).parse(JSON.parse(readFileSync(resolve(casesDir, file), "utf8")));
}

// Real labels from triage_feedback: no case file, no LLM call, no API key.
async function runReal(
  options: NonNullable<ReturnType<typeof readOptions>>,
  orgId: string,
  mailboxId: string
): Promise<number> {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const mail = options.synthetic ? "synthetic" : "real";
    const rows = await listLabeledResults(db, { orgId }, mailboxId, { mail });
    const report = buildRealReport(rows, {
      bar: options.bar,
      minKept: options["min-kept"],
      mail,
      now: new Date(),
    });
    const markdown = renderEvalReport(report, { title: `Eval report: ${mail} labels` });
    out(markdown);
    if (options.out !== undefined) writeFileSync(options.out, markdown);
    return evalExitCode(report);
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }
  if (options.real) return runReal(options, options["org-id"] as string, options["mailbox-id"] as string);

  const config = loadConfig();
  if (config.GEMINI_API_KEY === undefined) {
    log.error("GEMINI_API_KEY is missing");
    return 1;
  }
  const model = options.model ?? classifierModel(config);
  const llm = createLlmClient({
    apiKey: config.GEMINI_API_KEY,
    classifierModel: classifierModel(config),
    timeoutMs: config.GEMINI_TIMEOUT_MS,
    rpm: config.GEMINI_RPM,
  });

  const selected = [
    ...(options.set === "injection" ? [] : loadCases("synthetic.json")),
    ...(options.set === "synthetic" ? [] : loadCases("injection.json")),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cases = options.limit === undefined ? selected : selected.slice(0, options.limit);

  try {
    const report = await runEval(
      { llm, sleep: (ms) => new Promise((done) => setTimeout(done, ms)), now: () => new Date() },
      { cases, model, bar: options.bar, minKept: options["min-kept"], retries: options.retries }
    );
    const markdown = renderEvalReport(report, { title: `Eval report: ${options.set} set` });
    out(markdown);
    if (options.out !== undefined) writeFileSync(options.out, markdown);
    return evalExitCode(report);
  } catch (error) {
    if (error instanceof LlmConfigError) {
      log.error(`LLM config error ${error.code}`);
      return 1;
    }
    throw error;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", error instanceof Error ? error.name : "unknown error");
    process.exit(1);
  });
