import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { costPerMail } from "@ea/core";

import {
  buildGateFile,
  evalExitCode,
  evalDelegateAddress,
  gateFileName,
  gateFileRefusal,
  evalStateFileName,
  firstEstimateUsd,
  parseCaseResults,
  prompts,
  renderEvalReport,
  runEval,
  simMetaOf,
} from "../modules/triage";
import { type Config, ConfigError, llmRoleTable, loadConfig } from "../platform/config";
import { createLlmClient, LlmConfigError, type LlmRoleTable } from "../platform/llm";
import { createLog } from "../platform/log";

import { type EvalOptions, evalUsage } from "./eval-args";
import { judgeSetupError, simRoleTable } from "./eval-judge-setup";
import {
  acquireStateLock,
  appendLedgerLine,
  defaultLedgerPath,
  ledgerLine,
  MONTH_CAP_USD,
  monthOf,
  monthSpend,
  readLedger,
  runCap,
} from "./eval-ledger";
import { HOLDOUT_NEEDS_FREEZE, loadSimCases } from "./eval-sim-load";

const log = createLog("eval");

const simRoot = resolve(import.meta.dir, "../../../../evals/sim");
const runsDir = resolve(import.meta.dir, "../../../../evals/.runs");
const gateDir = resolve(import.meta.dir, "../../../../evals/results/gate");

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

// What a test replaces: the CLI passes none of them.
export interface SimDeps {
  config?: Config;
  createLlmClient?: typeof createLlmClient;
  now?: () => Date;
  root?: string;
  runsDir?: string;
  gateDir?: string;
}

// `eval --sim`: a corpus part through the worker pool, under the run cap and the month cap.
export async function runSim(options: EvalOptions, deps: SimDeps = {}): Promise<number> {
  const scenario = options.sim as string;
  const part = options.part as NonNullable<EvalOptions["part"]>;
  const config = deps.config ?? loadConfig();
  const root = deps.root ?? simRoot;
  const runs = deps.runsDir ?? runsDir;
  let table: LlmRoleTable;
  try {
    table = llmRoleTable(config, {
      classifier: {
        provider: options.provider,
        model: options.model,
        reasoningEffort: options["reasoning-effort"],
      },
      ...(options.judge ? { judge: { provider: options["judge-provider"], model: options["judge-model"] } } : {}),
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
  const judgeRow = options.judge ? table.roles.judge : undefined;
  const effort = row.reasoningEffort;

  // A model without a price today cannot be held to a cap, and a zero estimate would mean no cap.
  const startedAt = (deps.now ?? (() => new Date()))();
  const estimateUsd = firstEstimateUsd(model, startedAt);
  if (estimateUsd === null) {
    log.error(`no price for model ${model}: add it to llmPrices before a sim run`);
    return 1;
  }

  if (options.judge) {
    const problem = judgeSetupError(table, startedAt);
    if (problem !== null) {
      log.error(problem);
      return 1;
    }
  }

  let loaded: Awaited<ReturnType<typeof loadSimCases>>;
  try {
    loaded = await loadSimCases({ root, scenario, part, requireManifest: part === "holdout" });
  } catch (error) {
    log.error(
      error instanceof Error && error.message === HOLDOUT_NEEDS_FREEZE
        ? HOLDOUT_NEEDS_FREEZE
        : `corpus load failed: ${error instanceof Error ? error.name : "unknown error"}`
    );
    return 1;
  }
  const cases = options.limit === undefined ? loaded.cases : loaded.cases.slice(0, options.limit);
  log.info(
    `corpus ${scenario} v${loaded.version} part ${part}: ${cases.length} cases, skipped dropped ${loaded.skipped.dropped} unwritten ${loaded.skipped.unwritten} sent ${loaded.skipped.sent}`
  );

  let ledgerPath: string;
  try {
    ledgerPath =
      options["spend-ledger"] ??
      defaultLedgerPath({ XDG_STATE_HOME: process.env.XDG_STATE_HOME, HOME: process.env.HOME });
  } catch (error) {
    log.error(error instanceof Error ? error.message : "no ledger path");
    return 1;
  }
  const cap = runCap({
    requested: options.budgetUsd,
    monthSpent: monthSpend(readLedger(ledgerPath), monthOf(startedAt)),
    monthCap: MONTH_CAP_USD,
  });
  if (cap <= 0) {
    log.error("month budget used");
    return 1;
  }
  log.info(
    `provider=${row.provider} model=${model} effort=${effort ?? "-"}${judgeRow === undefined ? "" : ` judge=${judgeRow.provider}/${judgeRow.model}`} concurrency=${options.concurrency} rpm=${options.rpm} cap=$${cap}`
  );

  // `--rpm` is the classifier provider's rate; the judge provider keeps the configured rate (`--judge-rpm` overrides).
  const limited = simRoleTable(table, {
    rpm: options.rpm as number,
    judge: options.judge,
    judgeRpm: options["judge-rpm"],
    judgeRoleRpm: options["judge-provider"] === undefined ? undefined : config.LLM_JUDGE_RPM,
  });
  const llm = (deps.createLlmClient ?? createLlmClient)({ table: limited });

  const stateFile = resolve(
    runs,
    evalStateFileName({
      model,
      reasoningEffort: effort,
      promptVersion: prompts.classifier.version,
      set: `sim-${scenario}-v${loaded.version}-${part}`,
    })
  );
  mkdirSync(dirname(stateFile), { recursive: true });
  let release: () => void;
  try {
    release = acquireStateLock(stateFile, startedAt, { fresh: options["fresh-lock"] });
  } catch (error) {
    log.error(error instanceof Error ? error.message : "state lock failed");
    return 1;
  }

  let newSpendUsd = 0;
  const callCostUsd = (usage: { model: string; tokensIn: number; tokensOut: number }, at: Date) =>
    costPerMail(usage.model, usage.tokensIn, usage.tokensOut, at);
  try {
    if (options.fresh) rmSync(stateFile, { force: true });
    const done = existsSync(stateFile) ? parseCaseResults(readFileSync(stateFile, "utf8")) : [];
    log.info(`state ${stateFile}: ${done.length} earlier results`);
    const report = await runEval(
      {
        llm,
        sleep: (ms) => new Promise((finish) => setTimeout(finish, ms)),
        now: () => new Date(),
        onResult: async (result) => {
          appendFileSync(stateFile, `${JSON.stringify(result)}\n`);
        },
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
        concurrency: options.concurrency,
        ...(judgeRow === undefined
          ? {}
          : { judge: { llm, provider: judgeRow.provider, model: judgeRow.model, addressOf: evalDelegateAddress } }),
        budget: {
          capUsd: cap,
          callCostUsd,
          firstEstimateUsd: estimateUsd,
          // Every charge of the run, also a failed attempt: the ledger line holds the new spend.
          onSpend: (usd) => {
            newSpendUsd += usd;
          },
        },
      }
    );
    const sim = {
      report,
      meta: simMetaOf(loaded.cases),
      corpus: { scenario, version: loaded.version, manifestSha: loaded.manifestSha, audit: loaded.audit, part },
      hideIds: part === "holdout",
    };
    const markdown = renderEvalReport(report, { title: `Eval report: sim ${scenario} ${part}`, sim });
    out(markdown);
    if (options.out !== undefined) writeFileSync(options.out, markdown);
    // The gate file of a full holdout run at the default bar (D27); an older file of the same name is replaced.
    const refusal = gateFileRefusal(options, report);
    if (refusal !== null) {
      log.info(refusal);
    } else {
      const dir = deps.gateDir ?? gateDir;
      const name = gateFileName({
        role: report.role,
        promptVersion: report.promptVersion,
        model,
        reasoningEffort: effort,
        scenario,
        version: loaded.version,
      });
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, name), `${JSON.stringify(buildGateFile({ ...sim, now: new Date() }), null, 2)}\n`);
      log.info(`gate file: evals/results/gate/${name}`);
    }
    if (!report.complete) log.warn(`${report.stoppedReason ?? "run not complete"}: resume with the same command`);
    return evalExitCode(report);
  } catch (error) {
    if (error instanceof LlmConfigError) {
      log.error(`LLM config error ${error.code}`);
      return 1;
    }
    throw error;
  } finally {
    // One ledger line per run, also after a stop or an error: the new spend only.
    appendLedgerLine(
      ledgerPath,
      ledgerLine({ runId: randomUUID(), at: new Date(), usd: newSpendUsd, label: `${scenario}-${part}-${model}` })
    );
    release();
  }
}
