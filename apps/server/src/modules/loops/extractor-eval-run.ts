import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { costPerMail, type LlmEffortLevel, type SentPart } from "@ea/core";

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
import {
  createLlmClient,
  LlmConfigError,
  llmEndpointFields,
  type LlmProviderId,
  type LlmRoleTable,
} from "../../platform/llm";
import { corpusDir, readScenario } from "../../platform/sim-files";
import { readSentManifest, sentEvalCasesOf } from "../../platform/sim-sent-files";
import { evalStateFileName, firstEstimateUsd, gateFileName, prompts, runPool } from "../triage";

import {
  type ExtractorCaseResult,
  missIdsOf,
  parseExtractorResults,
  runExtractorCase,
  scoreExtractor,
  skipReasonOf,
} from "./extractor-eval";
import { buildExtractorGateFile, extractorExitCode, MAX_ERROR_SHARE, renderExtractorReport } from "./extractor-report";

const STOP_AFTER_ERRORS = 3;
const ERROR_STOP_REASON = "errors in a row (quota, overload or bad answers), resume later";

/** What the run prints through: the CLI output of a script, plus `raw` for the report. */
export interface EvalRunOutput {
  print(text: string): void;
  fail(text: string): void;
  raw(text: string): void;
}

/** The fields of the parsed `eval` options that an extractor run reads. */
export interface ExtractorEvalOptions {
  sim?: string;
  sentPart?: SentPart;
  provider?: LlmProviderId;
  model?: string;
  "reasoning-effort"?: LlmEffortLevel;
  limit?: number;
  "spend-ledger"?: string;
  budgetUsd: number;
  concurrency: number;
  rpm?: number;
  retries: number;
  fresh: boolean;
  "fresh-lock": boolean;
  out?: string;
}

// What the caller fills: the loaded config, the folders, the usage text and the env of the ledger path. A test replaces the rest.
export interface ExtractorEvalRunDeps {
  config: Config;
  root: string;
  runsDir: string;
  gateDir: string;
  usage: string;
  ledgerEnv: { XDG_STATE_HOME?: string; HOME?: string };
  createLlmClient?: typeof createLlmClient;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

// `eval --sim <scenario> --part sent-dev|sent-holdout --extractor`: the code filters and `extractSent` on every
// case of the part, under the run cap and the month cap. Exit 0: done (and the gate passed, on the holdout);
// 1: a setup error, a failed gate, or over 10% error cases; 2: a run flag the provider does not take; 4: the run stopped (cap or errors), resume it.
export async function runExtractorEvalRun(
  options: ExtractorEvalOptions,
  deps: ExtractorEvalRunDeps,
  cli: EvalRunOutput
): Promise<number> {
  const scenarioId = options.sim as string;
  const part = options.sentPart as SentPart;
  const holdout = part === "sent-holdout";
  const { config, root } = deps;

  let table: LlmRoleTable;
  try {
    table = llmRoleTable(
      config,
      runOverrides("extractor", {
        provider: options.provider,
        model: options.model,
        reasoningEffort: options["reasoning-effort"],
      })
    );
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    cli.fail(runFlagError(error));
    cli.fail(`usage: ${deps.usage}`);
    return runFlagExitCode(error);
  }
  const row = table.roles.extractor;
  const keys = table.providers[row.provider];
  if (keys.apiKey === undefined) {
    cli.fail(`${keys.apiKeyName} is missing`);
    return 1;
  }
  const model = row.model;
  const effort = row.reasoningEffort;
  const { endpoint, host } = llmEndpointFields(table, "extractor");
  // An own server costs nothing and has no price row: the run takes no budget. A paid model with no price today
  // cannot be held to a cap, so it is refused.
  const own = endpoint === "own";
  const startedAt = (deps.now ?? (() => new Date()))();
  const estimateUsd = own ? 0 : firstEstimateUsd(model, startedAt, endpoint);
  if (estimateUsd === null) {
    cli.fail(`no price for model ${model}: add it to llmPrices before an extractor run`);
    return 1;
  }

  const dir = corpusDir(scenarioId, root);
  const manifest = readSentManifest(dir);
  if (holdout && manifest === undefined) {
    cli.fail("holdout needs a frozen corpus: run sim freeze --bank sent");
    return 1;
  }
  let loaded: ReturnType<typeof sentEvalCasesOf>;
  let executive: { timeZone: string; address: string };
  try {
    executive = readScenario(dir).executive;
    loaded = sentEvalCasesOf(root, scenarioId, part, { holdout });
  } catch (error) {
    cli.fail(`corpus load failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return 1;
  }
  const frozen = manifest?.parts[part];
  if (frozen !== undefined && frozen.cases !== loaded.length) {
    cli.fail(`the part has ${loaded.length} cases and the manifest says ${frozen.cases}: run sim status`);
    return 1;
  }
  const version = manifest?.version ?? "draft";
  const cases = options.limit === undefined ? loaded : loaded.slice(0, options.limit);
  cli.print(`corpus ${scenarioId} ${version} part ${part}: ${cases.length} cases`);

  let ledgerPath: string;
  try {
    ledgerPath = options["spend-ledger"] ?? defaultLedgerPath(deps.ledgerEnv);
  } catch (error) {
    cli.fail(error instanceof Error ? error.message : "no ledger path");
    return 1;
  }
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
    `provider=${row.provider} endpoint=${endpoint} host=${host ?? "-"} model=${model} effort=${effort ?? "-"} prompt=${prompts.extractor.version} concurrency=${options.concurrency} rpm=${options.rpm} cap=${cap === null ? "none (own endpoint)" : `$${cap}`}`
  );

  // `--rpm` is the rate of the extractor provider for this process only (the rows are copied, the config is not changed).
  const limited: LlmRoleTable = {
    roles: { ...table.roles, extractor: { ...row, rpm: null } },
    providers: { ...table.providers, [row.provider]: { ...keys, rpm: options.rpm as number } },
  };
  const llm = (deps.createLlmClient ?? createLlmClient)({ table: limited });

  const stateFile = resolve(
    deps.runsDir,
    evalStateFileName({
      model,
      endpoint,
      reasoningEffort: effort,
      promptVersion: prompts.extractor.version,
      set: `sent-${scenarioId}-v${version}-${part}`,
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
  try {
    if (options.fresh) rmSync(stateFile, { force: true });
    // An error case has no answer: it runs again (the last line of a case wins).
    const earlier = existsSync(stateFile)
      ? parseExtractorResults(readFileSync(stateFile, "utf8")).filter((r) => r.errorCode === null)
      : [];
    cli.print(`state ${stateFile}: ${earlier.length} earlier results`);
    const input = { timeZone: executive.timeZone, ownAddresses: [executive.address], retries: options.retries };
    const outcome = await runPool<(typeof cases)[number], ExtractorCaseResult>({
      cases,
      earlier: new Map(earlier.map((r) => [r.id, r])),
      concurrency: options.concurrency,
      budget:
        cap === null
          ? undefined
          : {
              capUsd: cap,
              callCostUsd: (usage, at) => costPerMail(usage.model, usage.tokensIn, usage.tokensOut, at, endpoint),
              firstEstimateUsd: estimateUsd,
              onSpend: (usd) => {
                newSpendUsd += usd;
              },
            },
      stopAfterErrors: STOP_AFTER_ERRORS,
      errorStopReason: ERROR_STOP_REASON,
      now: startedAt,
      usesLlm: (c) => skipReasonOf(c, [executive.address]) === null,
      run: (c, attempts) =>
        runExtractorCase(
          { llm, sleep: deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))) },
          c,
          input,
          attempts
        ),
      onResult: async (result) => {
        appendFileSync(stateFile, `${JSON.stringify(result)}\n`);
        if (result.errorCode !== null) {
          // The dev ids help tuning. A holdout line holds the code only.
          cli.print(`case ${holdout ? "-" : result.id} failed: ${result.errorCode}`);
        }
      },
    });

    const results = cases.flatMap((c) => outcome.results.get(c.id) ?? []);
    const scores = scoreExtractor(cases, results);
    const complete = outcome.stoppedReason === null && results.length === cases.length;
    const markdown = renderExtractorReport({
      title: `Extractor eval: sim ${scenarioId} ${part}`,
      scores,
      header: {
        scenario: scenarioId,
        version,
        part,
        provider: row.provider,
        endpoint,
        host,
        model,
        reasoningEffort: effort,
        promptVersion: prompts.extractor.version,
        planned: cases.length,
        spentUsd: outcome.spentUsd,
        capUsd: cap,
        complete,
        stoppedReason: outcome.stoppedReason,
        llmCases: results.filter((r) => r.source === "llm").length,
      },
      ...(holdout ? {} : { misses: missIdsOf(cases, results) }),
    });
    cli.raw(markdown);
    if (options.out !== undefined) writeFileSync(options.out, markdown);

    // The gate file comes from a full holdout run only.
    if (!holdout) {
      cli.print("no gate file: part is not sent-holdout");
    } else if (options.limit !== undefined) {
      cli.print("no gate file: --limit is set");
    } else if (!complete || manifest === undefined) {
      cli.print("no gate file: the run is not complete");
    } else {
      const name = gateFileName({
        role: "extractor",
        endpoint,
        promptVersion: prompts.extractor.version,
        model,
        reasoningEffort: effort,
        scenario: scenarioId,
        version: manifest.version,
      });
      const gate = buildExtractorGateFile(scores, {
        scenario: scenarioId,
        version: manifest.version,
        partSha: (manifest.parts[part] as { sha256: string }).sha256,
        provider: row.provider,
        endpoint,
        host,
        model,
        reasoningEffort: effort,
        promptVersion: prompts.extractor.version,
        now: new Date(),
      });
      const target = deps.gateDir;
      mkdirSync(target, { recursive: true });
      writeFileSync(resolve(target, name), `${JSON.stringify(gate, null, 2)}\n`);
      cli.print(`gate file: evals/results/gate/${name} passed=${gate.passed}`);
    }

    const code = extractorExitCode({ complete, holdout, scores });
    if (!complete) cli.fail(`${outcome.stoppedReason ?? "run not complete"}: resume with the same command`);
    else if (scores.errors > scores.cases * MAX_ERROR_SHARE) {
      cli.fail(`${scores.errors} error cases of ${scores.cases}: more than 10%`);
    } else if (code === 1) cli.fail("the extractor gate failed: see the bars in the report");
    return code;
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
      ledgerLine({ runId: randomUUID(), at: new Date(), usd: newSpendUsd, label: `${scenarioId}-${part}-${model}` })
    );
    release();
  }
}
