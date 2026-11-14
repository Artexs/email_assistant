import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { type EvalCase, evalCaseSchema, selectCases } from "@ea/core";
import { z } from "zod";

import {
  buildRealReport,
  evalExitCode,
  evalStateFileName,
  listLabeledResults,
  parseCaseResults,
  prompts,
  renderEvalReport,
  runEval,
} from "../modules/triage";
import { ConfigError, llmRoleTable, loadConfig, testMailRule } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { createLlmClient, LlmConfigError, type LlmRoleTable } from "../platform/llm";
import { createLog } from "../platform/log";

import { type EvalOptions, evalUsage, parseEvalArgs } from "./eval-args";
import { runSim } from "./eval-sim";

const log = createLog("eval");

const casesDir = resolve(import.meta.dir, "../../../../evals/cases");
const runsDir = resolve(import.meta.dir, "../../../../evals/.runs");

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function loadCases(file: string): EvalCase[] {
  return z.array(evalCaseSchema).parse(JSON.parse(readFileSync(resolve(casesDir, file), "utf8")));
}

// Real labels from triage_feedback: no case file, no LLM call, no API key.
async function runReal(options: EvalOptions, orgId: string, mailboxId: string): Promise<number> {
  const config = loadConfig();
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
    return evalExitCode(report);
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<number> {
  const options = parseEvalArgs(process.argv.slice(2));
  if (!options) {
    log.error(evalUsage);
    return 1;
  }
  if (options.sim !== undefined) return runSim(options);
  if (options.real) return runReal(options, options["org-id"] as string, options["mailbox-id"] as string);

  const config = loadConfig();
  let table: LlmRoleTable;
  try {
    table = llmRoleTable(config, {
      classifier: {
        provider: options.provider,
        model: options.model,
        reasoningEffort: options["reasoning-effort"],
      },
    });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    log.error(evalUsage);
    return 1;
  }
  const row = table.roles.classifier;
  const keys = table.providers[row.provider];
  if (keys.apiKey === undefined) {
    log.error(`${keys.apiKeyName} is missing`);
    return 1;
  }
  const model = row.model;
  const effort = row.reasoningEffort;
  log.info(`provider=${row.provider} model=${model} effort=${effort ?? "-"}`);
  const llm = createLlmClient({ table });

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
  const stateFile =
    options.state ??
    resolve(
      runsDir,
      evalStateFileName({
        model,
        reasoningEffort: effort,
        promptVersion: prompts.classifier.version,
        set: options.set,
        perCategory: options["per-category"],
      })
    );
  if (options.fresh) rmSync(stateFile, { force: true });
  mkdirSync(dirname(stateFile), { recursive: true });
  const done = existsSync(stateFile) ? parseCaseResults(readFileSync(stateFile, "utf8")) : [];
  log.info(`state ${stateFile}: ${done.length} earlier results`);

  try {
    const report = await runEval(
      {
        llm,
        sleep: (ms) => new Promise((finish) => setTimeout(finish, ms)),
        now: () => new Date(),
        onResult: async (result) => appendFileSync(stateFile, `${JSON.stringify(result)}\n`),
      },
      {
        cases,
        model,
        provider: row.provider,
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
    if (!report.complete) log.warn(`${report.stoppedReason ?? "run not complete"}: resume with the same command`);
    return code;
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
