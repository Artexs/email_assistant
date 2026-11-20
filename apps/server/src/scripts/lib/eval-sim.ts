import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { costPerMail, type EvalCase } from "@ea/core";

import {
  buildGateFile,
  type ClassifierExtras,
  evalExitCode,
  evalDelegateAddress,
  gateFileName,
  gateFileRefusal,
  evalStateFileName,
  firstEstimateUsd,
  gateIdentityOf,
  parseCaseResults,
  promptLabel,
  renderEvalReport,
  runEval,
  simMetaOf,
} from "../../modules/triage";
import { createCliOutput } from "../../platform/cli";
import {
  type Config,
  ConfigError,
  llmRoleTable,
  runFlagError,
  runFlagExitCode,
  runOverrides,
} from "../../platform/config";
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
} from "../../platform/eval-ledger";
import { createLlmClient, LlmConfigError, llmEndpointFields, type LlmRoleTable } from "../../platform/llm";
import { corpusDir, readScenario } from "../../platform/sim-files";
import { type EvalOptions, evalUsage } from "../eval-args";

import { loadEvalConfig } from "./eval-config";
import { classifierExtrasOfCase } from "./eval-extras";
import { evalFailureLine } from "./eval-failure-line";
import { judgeSetupError, simRoleTable } from "./eval-judge-setup";
import { HOLDOUT_NEEDS_FREEZE, loadSimCases } from "./eval-sim-load";

const cli = createCliOutput("eval");

const simRoot = resolve(import.meta.dir, "../../../../../evals/sim");
const runsDir = resolve(import.meta.dir, "../../../../../evals/.runs");
const gateDir = resolve(import.meta.dir, "../../../../../evals/results/gate");

function out(text: string): void {
  cli.write(`${text}\n`);
}

function extrasMapperOf(
  options: EvalOptions,
  root: string,
  scenarioId: string,
  htmlById: ReadonlyMap<string, string>
): ((c: EvalCase) => ClassifierExtras) | undefined {
  if (options.prompt.version === "classifier-v2") return undefined;
  const scenario = readScenario(corpusDir(scenarioId, root));
  return (evalCase) => classifierExtrasOfCase(evalCase, scenario, htmlById.get(evalCase.id));
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
  const config = deps.config ?? loadEvalConfig();
  if (config === null) return 1;
  const root = deps.root ?? simRoot;
  const runs = deps.runsDir ?? runsDir;
  let table: LlmRoleTable;
  try {
    table = llmRoleTable(
      config,
      runOverrides("classifier", {
        provider: options.provider,
        model: options.model,
        reasoningEffort: options["reasoning-effort"],
        judgeProvider: options["judge-provider"],
        judgeModel: options["judge-model"],
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
  const judgeRow = options.judge ? table.roles.judge : undefined;
  const effort = row.reasoningEffort;

  const { endpoint, host } = llmEndpointFields(table, "classifier");
  // An own server costs nothing and has no price row: the run takes no budget. The judge is a paid provider
  // here, so an own run with `--judge` would send paid calls with no cap: it is refused.
  const own = endpoint === "own";
  if (own && options.judge) {
    cli.fail("an own endpoint run has no USD budget, so it cannot use --judge (the judge is a paid provider)");
    return 1;
  }
  // A paid run (standard or eu) of a model without a price today cannot be held to a cap, and a zero estimate would
  // mean no cap: it is refused. This guard stays for every endpoint that costs money.
  const startedAt = (deps.now ?? (() => new Date()))();
  const estimateUsd = own ? 0 : firstEstimateUsd(model, startedAt, endpoint);
  if (estimateUsd === null) {
    cli.fail(`no price for model ${model}: add it to llmPrices before a sim run`);
    return 1;
  }
  if (options.judge) {
    const problem = judgeSetupError(table, startedAt);
    if (problem !== null) {
      cli.fail(problem);
      return 1;
    }
  }

  let loaded: Awaited<ReturnType<typeof loadSimCases>>;
  try {
    loaded = await loadSimCases({ root, scenario, part, requireManifest: part === "holdout" });
  } catch (error) {
    cli.fail(
      error instanceof Error && error.message === HOLDOUT_NEEDS_FREEZE
        ? HOLDOUT_NEEDS_FREEZE
        : `corpus load failed: ${error instanceof Error ? error.name : "unknown error"}`
    );
    return 1;
  }
  const cases = options.limit === undefined ? loaded.cases : loaded.cases.slice(0, options.limit);
  cli.print(
    `corpus ${scenario} v${loaded.version} part ${part}: ${cases.length} cases, skipped dropped ${loaded.skipped.dropped} unwritten ${loaded.skipped.unwritten} sent ${loaded.skipped.sent}`
  );

  // The scenario holds the known senders and the time zone of the extras.
  const extrasOf = extrasMapperOf(options, root, scenario, loaded.htmlById);

  let ledgerPath: string;
  try {
    ledgerPath =
      options["spend-ledger"] ??
      defaultLedgerPath({ XDG_STATE_HOME: process.env.XDG_STATE_HOME, HOME: process.env.HOME });
  } catch (error) {
    cli.fail(error instanceof Error ? error.message : "no ledger path");
    return 1;
  }
  // An own run spends nothing, so the month cap does not apply to it.
  const cap = own
    ? null
    : runCap({
        requested: options.budgetUsd,
        monthSpent: monthSpend(readLedger(ledgerPath), monthOf(startedAt)),
        monthCap: MONTH_CAP_USD,
      });
  if (cap !== null && cap <= 0) {
    cli.fail("month budget used");
    return 1;
  }
  cli.print(
    `provider=${row.provider} endpoint=${endpoint} host=${host ?? "-"} model=${model} effort=${effort ?? "-"}${judgeRow === undefined ? "" : ` judge=${judgeRow.provider}/${judgeRow.model}`} concurrency=${options.concurrency} rpm=${options.rpm} cap=${cap === null ? "none (own endpoint)" : `$${cap}`}`
  );

  // `--rpm` is the classifier provider's rate (the judge too, on the same provider); `--judge-rpm` limits only the judge role.
  const limited = simRoleTable(table, {
    rpm: options.rpm as number,
    judge: options.judge,
    judgeRpm: options["judge-rpm"],
  });
  const llm = (deps.createLlmClient ?? createLlmClient)({ table: limited });

  const stateFile = resolve(
    runs,
    evalStateFileName({
      model,
      endpoint,
      reasoningEffort: effort,
      // The version and the sorted parts: two variants never share a state file.
      promptVersion: promptLabel(options.prompt),
      set: `sim-${scenario}-v${loaded.version}-${part}`,
      judgeModel: judgeRow?.model,
    })
  );
  mkdirSync(dirname(stateFile), { recursive: true });
  let release: () => void;
  try {
    release = acquireStateLock(stateFile, startedAt, { fresh: options["fresh-lock"] });
  } catch (error) {
    cli.fail(error instanceof Error ? error.message : "state lock failed");
    return 1;
  }

  let newSpendUsd = 0;
  // The judge model differs from the classifier model: a call is priced at the endpoint of the judge's provider.
  const endpointOfModel = (usedModel: string) =>
    judgeRow !== undefined && usedModel === judgeRow.model && usedModel !== model
      ? table.providers[judgeRow.provider].endpoint
      : endpoint;
  const callCostUsd = (usage: { model: string; tokensIn: number; tokensOut: number }, at: Date) =>
    costPerMail(usage.model, usage.tokensIn, usage.tokensOut, at, endpointOfModel(usage.model));
  try {
    if (options.fresh) rmSync(stateFile, { force: true });
    const done = existsSync(stateFile) ? parseCaseResults(readFileSync(stateFile, "utf8")) : [];
    cli.print(`state ${stateFile}: ${done.length} earlier results`);
    const report = await runEval(
      {
        llm,
        sleep: (ms) => new Promise((finish) => setTimeout(finish, ms)),
        now: () => new Date(),
        onResult: async (result) => {
          appendFileSync(stateFile, `${JSON.stringify(result)}\n`);
        },
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
        prompt: options.prompt,
        // Only v3 reads extras; v2 ignores them.
        ...(extrasOf === undefined ? {} : { extrasOf }),
        concurrency: options.concurrency,
        ...(judgeRow === undefined
          ? {}
          : { judge: { llm, provider: judgeRow.provider, model: judgeRow.model, addressOf: evalDelegateAddress } }),
        // An own run has no budget (no cap, no price check): the ledger line stays $0.
        ...(cap === null
          ? {}
          : {
              budget: {
                capUsd: cap,
                callCostUsd,
                firstEstimateUsd: estimateUsd,
                // Every charge of the run, also a failed attempt: the ledger line holds the new spend.
                onSpend: (usd: number) => {
                  newSpendUsd += usd;
                },
              },
            }),
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
    // The gate file of a full holdout run at the default bar; an older file of the same name is replaced.
    const refusal = gateFileRefusal(options, report);
    if (refusal !== null) {
      cli.print(refusal);
    } else {
      const dir = deps.gateDir ?? gateDir;
      const identity = gateIdentityOf(report);
      const name = gateFileName({
        role: identity.role,
        endpoint: identity.endpoint,
        promptVersion: identity.promptVersion,
        model: identity.model,
        reasoningEffort: identity.reasoningEffort,
        scenario,
        version: loaded.version,
      });
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, name), `${JSON.stringify(buildGateFile({ ...sim, now: new Date() }), null, 2)}\n`);
      cli.print(`gate file: evals/results/gate/${name}`);
    }
    if (!report.complete) cli.fail(`${report.stoppedReason ?? "run not complete"}: resume with the same command`);
    return evalExitCode(report);
  } catch (error) {
    if (error instanceof LlmConfigError) {
      cli.fail(`LLM config error ${error.code}`);
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
