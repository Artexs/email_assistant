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
  prompts,
  renderEvalReport,
  runEval,
  simMetaOf,
} from "../modules/triage";
import { createCliOutput } from "../platform/cli";
import { type Config, ConfigError, llmRoleTable } from "../platform/config";
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
} from "../platform/eval-ledger";
import { createLlmClient, LlmConfigError, llmEndpointFields, type LlmRoleTable } from "../platform/llm";
import { corpusDir, readScenario } from "../platform/sim-files";

import { type EvalOptions, evalUsage } from "./eval-args";
import { loadEvalConfig } from "./eval-config";
import { classifierExtrasOfCase } from "./eval-extras";
import { judgeSetupError, simRoleTable } from "./eval-judge-setup";
import { HOLDOUT_NEEDS_FREEZE, loadSimCases } from "./eval-sim-load";

const cli = createCliOutput("eval");

const simRoot = resolve(import.meta.dir, "../../../../evals/sim");
const runsDir = resolve(import.meta.dir, "../../../../evals/.runs");
const gateDir = resolve(import.meta.dir, "../../../../evals/results/gate");

function out(text: string): void {
  process.stdout.write(`${text}\n`);
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
    table = llmRoleTable(config, {
      classifier: {
        provider: options.provider,
        model: options.model,
        reasoningEffort: options["reasoning-effort"],
      },
      ...(options.judge ? { judge: { provider: options["judge-provider"], model: options["judge-model"] } } : {}),
      // Without the flags the role row applies; its effort falls back to the classifier's (review N13).
      ...(options.escalate
        ? {
            escalation: {
              model: options["escalation-model"],
              reasoningEffort: options["escalation-reasoning-effort"],
            },
          }
        : {}),
    });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    cli.fail(evalUsage);
    return 1;
  }
  const row = table.roles.classifier;
  const keys = table.providers[row.provider];
  if (keys.apiKey === undefined) {
    cli.fail(`${keys.apiKeyName} is missing`);
    return 1;
  }
  const model = row.model;
  const escalationRow = options.escalate ? table.roles.escalation : undefined;
  const escalationKeys = escalationRow === undefined ? undefined : table.providers[escalationRow.provider];
  if (escalationKeys !== undefined && escalationKeys.apiKey === undefined) {
    cli.fail(`${escalationKeys.apiKeyName} is missing`);
    return 1;
  }
  const judgeRow = options.judge ? table.roles.judge : undefined;
  const effort = row.reasoningEffort;

  const { endpoint, host } = llmEndpointFields(table, "classifier");
  // An own server costs nothing and has no price row: the run takes no budget (D12). The judge is a paid provider
  // (PD-026), so an own run with `--judge` would send paid calls with no cap: it is refused.
  const own = endpoint === "own";
  if (own && options.judge) {
    cli.fail("an own endpoint run has no USD budget, so it cannot use --judge (the judge is a paid provider)");
    return 1;
  }
  // A paid run (standard or eu) of a model without a price today cannot be held to a cap, and a zero estimate would
  // mean no cap: it is refused. This guard stays for every endpoint that costs money.
  const startedAt = (deps.now ?? (() => new Date()))();
  const classifierEstimateUsd = own ? 0 : firstEstimateUsd(model, startedAt, endpoint);
  if (classifierEstimateUsd === null) {
    cli.fail(`no price for model ${model}: add it to llmPrices before a sim run`);
    return 1;
  }
  // A mail may cost both calls: the estimate of the first call of a run covers the two (the budget stays safe).
  let estimateUsd = classifierEstimateUsd;
  if (escalationRow !== undefined && escalationKeys !== undefined) {
    if (own) {
      cli.fail("an own endpoint run has no USD budget, so it cannot use --escalate (the escalation model is priced)");
      return 1;
    }
    const escalationEstimateUsd = firstEstimateUsd(escalationRow.model, startedAt, escalationKeys.endpoint);
    if (escalationEstimateUsd === null) {
      cli.fail(`no price for model ${escalationRow.model}: add it to llmPrices before an escalated sim run`);
      return 1;
    }
    estimateUsd += escalationEstimateUsd;
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
    `provider=${row.provider} endpoint=${endpoint} host=${host ?? "-"} model=${model} effort=${effort ?? "-"}${judgeRow === undefined ? "" : ` judge=${judgeRow.provider}/${judgeRow.model}`} ${escalationRow === undefined ? "" : ` escalation=${escalationRow.provider}/${escalationRow.model}/${escalationRow.reasoningEffort ?? "-"}`} concurrency=${options.concurrency} rpm=${options.rpm} cap=${cap === null ? "none (own endpoint)" : `$${cap}`}`
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
      endpoint,
      reasoningEffort: effort,
      // The version and the sorted parts: two variants never share a state file.
      promptVersion:
        escalationRow === undefined
          ? promptLabel(options.prompt)
          : `${promptLabel(options.prompt)}+${prompts.escalation.version}-${escalationRow.model}-${escalationRow.reasoningEffort ?? "default"}`,
      set: `sim-${scenario}-v${loaded.version}-${part}`,
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
  // The judge is on another provider than the classifier (PD-026): a call is priced at the endpoint of its provider.
  const endpointOfModel = (usedModel: string) =>
    judgeRow !== undefined && usedModel === judgeRow.model && usedModel !== model
      ? table.providers[judgeRow.provider].endpoint
      : escalationRow !== undefined && usedModel === escalationRow.model && usedModel !== model
        ? table.providers[escalationRow.provider].endpoint
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
        ...(escalationRow === undefined
          ? {}
          : {
              escalation: {
                provider: escalationRow.provider,
                model: escalationRow.model,
                host: llmEndpointFields(table, "escalation").host,
                reasoningEffort: escalationRow.reasoningEffort,
              },
            }),
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
    // The gate file of a full holdout run at the default bar (D27); an older file of the same name is replaced.
    const refusal = gateFileRefusal(options, report);
    if (refusal !== null) {
      cli.print(refusal);
    } else {
      const dir = deps.gateDir ?? gateDir;
      // A cascade run names its file by the escalation row, so it never replaces the classifier's file.
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
