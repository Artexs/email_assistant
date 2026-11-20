import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { type EvalCase, evalCaseSchema, selectCases } from "@ea/core";
import { z } from "zod";

import {
  buildRealReport,
  evalExitCode,
  evalStateFileName,
  GapInputError,
  gateFileError,
  gateFileSchema,
  listLabeledResults,
  parseCaseResults,
  prompts,
  realCounts,
  realCountsSchema,
  renderEvalReport,
  renderGap,
  runEval,
} from "../modules/triage";
import { createCliOutput, runCli } from "../platform/cli";
import {
  type Config,
  ConfigError,
  llmRoleTable,
  runFlagError,
  runFlagExitCode,
  runOverrides,
  testMailRule,
} from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { createLlmClient, LlmConfigError, llmEndpointFields, type LlmRoleTable } from "../platform/llm";

import { cliDescriptions, type EvalOptions, evalUsage, parseEvalArgs } from "./eval-args";
import { loadEvalConfig } from "./lib/eval-config";
import { runDrafterEval } from "./lib/eval-drafter";
import { runExtractorEval } from "./lib/eval-extractor";
import { evalFailureLine } from "./lib/eval-failure-line";
import { runSim } from "./lib/eval-sim";
import { runStylistEval } from "./lib/eval-stylist";
import { runSuspicious } from "./lib/eval-suspicious";

const cli = createCliOutput("eval");

const casesDir = resolve(import.meta.dir, "../../../../evals/cases");
const runsDir = resolve(import.meta.dir, "../../../../evals/.runs");

function out(text: string): void {
  cli.write(`${text}\n`);
}

function loadCases(file: string): EvalCase[] {
  return z.array(evalCaseSchema).parse(JSON.parse(readFileSync(resolve(casesDir, file), "utf8")));
}

// Real labels from triage_feedback: no case file, no LLM call, no API key.
export async function runReal(options: EvalOptions, orgId: string, mailboxId: string): Promise<number> {
  const config = loadEvalConfig();
  if (config === null) return 1;
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const mail = options.synthetic ? "synthetic" : "real";
    const rows = await listLabeledResults(db, { orgId }, mailboxId, { mail, testMail: testMailRule(config) });
    const report = buildRealReport(rows, {
      bar: options.bar,
      minKept: options["min-kept"],
      mail,
      now: new Date(),
      model: options.model,
    });
    const markdown = renderEvalReport(report, {
      title: `Eval report: ${mail} labels${options.model === undefined ? "" : `, model ${options.model}`}`,
    });
    out(markdown);
    if (options.out !== undefined) writeFileSync(options.out, markdown);
    // Counts only: no mail id, no address, no text.
    if (options.jsonOut !== undefined)
      writeFileSync(options.jsonOut, `${JSON.stringify(realCounts(report), null, 2)}\n`);
    return evalExitCode(report);
  } finally {
    await db.destroy();
  }
}

// The sim-vs-real gap: two files, no DB, no LLM key.
function runGap(options: EvalOptions): number {
  try {
    const sim = gateFileSchema.safeParse(JSON.parse(readFileSync(options["sim-json"] as string, "utf8")));
    if (!sim.success) throw gateFileError(sim.error.issues[0]?.path ?? []);
    const real = realCountsSchema.safeParse(JSON.parse(readFileSync(options["real-json"] as string, "utf8")));
    if (!real.success) throw new GapInputError((real.error.issues[0]?.path ?? []).map(String).join("."), "real counts");
    const markdown = renderGap({ sim: sim.data, real: real.data });
    out(markdown);
    if (options.out !== undefined) writeFileSync(options.out, markdown);
    return 0;
  } catch (error) {
    if (
      error instanceof GapInputError ||
      error instanceof SyntaxError ||
      (error as { code?: string }).code === "ENOENT"
    ) {
      cli.fail(error instanceof GapInputError ? `${error.message}` : "cannot read or parse an input file");
      return 1;
    }
    throw error;
  }
}

// `runCli` prints the help, the usage error and the uncaught error; the output of a run goes through `cli`.
async function main(argv: string[]): Promise<number> {
  const options = parseEvalArgs(argv);
  if (options.gap) return runGap(options);
  if (options.stylist) return runStylistEval(options);
  if (options.drafter) return runDrafterEval(options);
  if (options.extractor) return runExtractorEval(options);
  if (options.suspicious) return runSuspicious(options);
  if (options.sim !== undefined) return runSim(options);
  if (options.real) return runReal(options, options["org-id"] as string, options["mailbox-id"] as string);
  return runClassifier(options);
}

// What a test replaces: the CLI passes none of them.
export interface ClassifierDeps {
  config?: Config;
  createLlmClient?: typeof createLlmClient;
  runsDir?: string;
}

// The old case sets through the classifier: no DB, a key for the provider.
export async function runClassifier(options: EvalOptions, deps: ClassifierDeps = {}): Promise<number> {
  const config = deps.config ?? loadEvalConfig();
  if (config === null) return 1;
  let table: LlmRoleTable;
  try {
    table = llmRoleTable(
      config,
      runOverrides("classifier", {
        provider: options.provider,
        model: options.model,
        reasoningEffort: options["reasoning-effort"],
      })
    );
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    cli.fail(runFlagError(error));
    cli.fail(`usage: ${evalUsage}`);
    return runFlagExitCode(error);
  }
  const row = table.roles.classifier;
  const keys = table.providers[row.provider];
  if (keys.apiKey === undefined) {
    cli.fail(`${keys.apiKeyName} is missing`);
    return 1;
  }
  const model = row.model;
  const effort = row.reasoningEffort;
  const { endpoint, host } = llmEndpointFields(table, "classifier");
  cli.print(`provider=${row.provider} endpoint=${endpoint} host=${host ?? "-"} model=${model} effort=${effort ?? "-"}`);
  const llm = (deps.createLlmClient ?? createLlmClient)({ table });

  const selected = selectCases(
    [
      ...(options.set === "synthetic" || options.set === "all" ? loadCases("synthetic.json") : []),
      ...(options.set === "injection" || options.set === "all" ? loadCases("injection.json") : []),
      ...(options.set === "delegation" || options.set === "all" ? loadCases("delegation.json") : []),
    ],
    { perCategory: options["per-category"] }
  );
  const cases = options.limit === undefined ? selected : selected.slice(0, options.limit);

  // The state file holds per-case results (ids, categories, numbers), no mail text. It lives outside git.
  // An explicit `--state` path gets no endpoint suffix: the caller keeps one endpoint per file.
  const stateFile =
    options.state ??
    resolve(
      deps.runsDir ?? runsDir,
      evalStateFileName({
        model,
        endpoint,
        reasoningEffort: effort,
        promptVersion: prompts.classifier.version,
        set: options.set,
        perCategory: options["per-category"],
      })
    );
  if (options.fresh) rmSync(stateFile, { force: true });
  mkdirSync(dirname(stateFile), { recursive: true });
  const done = existsSync(stateFile) ? parseCaseResults(readFileSync(stateFile, "utf8")) : [];
  cli.print(`state ${stateFile}: ${done.length} earlier results`);

  try {
    const report = await runEval(
      {
        llm,
        sleep: (ms) => new Promise((finish) => setTimeout(finish, ms)),
        now: () => new Date(),
        onResult: async (result) => appendFileSync(stateFile, `${JSON.stringify(result)}\n`),
        onCaseFailed: (failure) => cli.print(evalFailureLine(failure)),
      },
      {
        cases,
        model,
        provider: row.provider,
        host,
        reasoningEffort: effort,
        bar: options.bar,
        minKept: options["min-kept"],
        retries: options.retries,
        done,
      }
    );
    const markdown = renderEvalReport(report, { title: `Eval report: ${options.set} set` });
    out(markdown);
    if (options.out !== undefined) writeFileSync(options.out, markdown);
    const code = evalExitCode(report);
    if (!report.complete) cli.fail(`${report.stoppedReason ?? "run not complete"}: resume with the same command`);
    return code;
  } catch (error) {
    if (error instanceof LlmConfigError) {
      cli.fail(`LLM config error ${error.code}`);
      return 1;
    }
    throw error;
  }
}

// A test imports `runClassifier` without running the CLI.
if (import.meta.main) {
  await runCli({ prefix: "eval", descriptions: cliDescriptions, main });
}
