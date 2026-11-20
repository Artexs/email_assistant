import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { costPerMail, type EvalCase } from "@ea/core";

import {
  type DrafterCaseResult,
  drafterExitCode,
  type DrafterReportHeader,
  injectionSummary,
  injectionVerdict,
  needsRerun,
  parseDrafterResults,
  renderInjectionReport,
  renderSimDrafterReport,
  runDrafterCase,
  scoreDrafter,
  sendAsIs,
} from "../../modules/replies";
import {
  drafterVersions,
  evalStateFileName,
  firstEstimateUsd,
  judgeVersions,
  prompts,
  runPool,
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
import { type EvalOptions, evalUsage } from "../eval-args";

import { loadEvalConfig } from "./eval-config";
import { gateCheck, writeDrafterGate } from "./eval-drafter-gate";
import { dumpLine, loadSource, type Source } from "./eval-drafter-source";
import {
  type DrafterStyle,
  loadStyle,
  StyleFileError,
  styleHeader,
  styleSuffix,
  writingStyleOf,
} from "./eval-drafter-style";
import { judgeSetupError, simRoleTable } from "./eval-judge-setup";
import { HOLDOUT_NEEDS_FREEZE } from "./eval-sim-load";

const cli = createCliOutput("eval");

const runsDir = resolve(import.meta.dir, "../../../../../evals/.runs");
const gateDir = resolve(import.meta.dir, "../../../../../evals/results/gate");

const STOP_AFTER_ERRORS = 3;
const ERROR_STOP_REASON = "errors in a row (quota, overload or bad answers), resume later";

// What a test replaces: the CLI passes none of them.
export interface DrafterEvalCliDeps {
  config?: Config;
  createLlmClient?: typeof createLlmClient;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  root?: string;
  runsDir?: string;
  gateDir?: string;
  injectionFile?: string;
  commitmentFile?: string;
}

// `eval --sim <scenario> --part dev|holdout|week --drafter` and `eval --set reply-injection|reply-commitment --drafter
// --judge`: the reply drafter on every needs_reply case (the label, not a prediction: the drafter is measured alone),
// graded by the judge.
// Exit 0: done (and the gate or the injection bar passed); 1: a setup error, a failed gate, an injection set under
// 100% or over 10% error cases; 2: a run flag the provider does not take; 4: the run stopped (cap or errors), resume it.
export async function runDrafterEval(options: EvalOptions, deps: DrafterEvalCliDeps = {}): Promise<number> {
  const config = deps.config ?? loadEvalConfig();
  if (config === null) return 1;
  let table: LlmRoleTable;
  try {
    table = llmRoleTable(
      config,
      runOverrides("drafter", {
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
  const row = table.roles.drafter;
  const keys = table.providers[row.provider];
  if (keys.apiKey === undefined) {
    cli.fail(`${keys.apiKeyName} is missing`);
    return 1;
  }
  const judgeRow = options.judge ? table.roles.judge : undefined;
  const drafterPrompt =
    options["drafter-prompt"] === undefined ? prompts.drafter : drafterVersions[options["drafter-prompt"]];
  const judgePrompt = options["judge-prompt"] === undefined ? prompts.judge : judgeVersions[options["judge-prompt"]];
  const { endpoint, host } = llmEndpointFields(table, "drafter");
  const own = endpoint === "own";
  if (own && options.judge) {
    cli.fail("an own endpoint run has no USD budget, so it cannot use --judge (the judge is a paid provider)");
    return 1;
  }
  let style: DrafterStyle;
  try {
    style = loadStyle(options.style);
  } catch (error) {
    if (!(error instanceof StyleFileError)) throw error;
    cli.fail(error.message);
    return 1;
  }
  const startedAt = (deps.now ?? (() => new Date()))();
  const estimateUsd = own ? 0 : firstEstimateUsd(row.model, startedAt, endpoint);
  if (estimateUsd === null) {
    cli.fail(`no price for model ${row.model}: add it to llmPrices before a drafter run`);
    return 1;
  }
  if (options.judge) {
    const problem = judgeSetupError(table, startedAt, "drafter");
    if (problem !== null) {
      cli.fail(problem);
      return 1;
    }
  }

  let source: Source;
  try {
    source = await loadSource(options, deps);
  } catch (error) {
    cli.fail(
      error instanceof Error && error.message === HOLDOUT_NEEDS_FREEZE
        ? HOLDOUT_NEEDS_FREEZE
        : `case load failed: ${error instanceof Error ? error.name : "unknown error"}`
    );
    return 1;
  }
  const persona = { ...source.persona, writingStyle: writingStyleOf(style, source.referenceStyle) };
  const runKey = `${source.key}${styleSuffix(style)}`;
  const holdout = options.part === "holdout";
  const needsReply = source.cases.filter((c) => c.expected.category === "needs_reply");
  const cases = options.limit === undefined ? needsReply : needsReply.slice(0, options.limit);
  const languageById = new Map(cases.map((c) => [c.id, c.lang]));
  const plantedIds = new Set(cases.filter((c) => (c.sim?.planted ?? []).length > 0).map((c) => c.id));
  cli.print(
    `${source.data}: ${cases.length} needs_reply cases (${source.cases.length - needsReply.length} of other labels left out)`
  );

  let ledgerPath: string;
  try {
    ledgerPath =
      options["spend-ledger"] ??
      defaultLedgerPath({ XDG_STATE_HOME: process.env.XDG_STATE_HOME, HOME: process.env.HOME });
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
    `provider=${row.provider} endpoint=${endpoint} host=${host ?? "-"} model=${row.model} effort=${row.reasoningEffort ?? "-"} prompt=${drafterPrompt.version}${judgeRow === undefined ? "" : ` judge=${judgeRow.provider}/${judgeRow.model} ${judgePrompt.version}`} concurrency=${options.concurrency} rpm=${options.rpm} cap=${cap === null ? "none (own endpoint)" : `$${cap}`}`
  );

  // `--rpm` is the rate of the drafter provider for this process only (the judge too, on the same provider); `--judge-rpm` limits only the judge role.
  const rated = simRoleTable(table, {
    rpm: options.rpm as number,
    judge: options.judge,
    judgeRpm: options["judge-rpm"],
    role: "drafter",
  });
  const limited: LlmRoleTable = { ...rated, roles: { ...rated.roles, drafter: { ...rated.roles.drafter, rpm: null } } };
  const llm = (deps.createLlmClient ?? createLlmClient)({ table: limited });

  const stateFile = resolve(
    deps.runsDir ?? runsDir,
    evalStateFileName({
      model: row.model,
      endpoint,
      reasoningEffort: row.reasoningEffort,
      promptVersion: drafterPrompt.version,
      set: `drafter-${runKey}`,
      judgeModel: judgeRow?.model,
      judgeVersion: judgeRow === undefined ? undefined : judgePrompt.version,
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
  // The judge model differs from the drafter model: a call is priced at the endpoint of the judge's provider.
  const endpointOfModel = (usedModel: string) =>
    judgeRow !== undefined && usedModel === judgeRow.model && usedModel !== row.model
      ? table.providers[judgeRow.provider].endpoint
      : endpoint;
  try {
    if (options.fresh) rmSync(stateFile, { force: true });
    const earlier = existsSync(stateFile)
      ? parseDrafterResults(readFileSync(stateFile, "utf8")).filter((r) => !needsRerun(r, options.judge))
      : [];
    cli.print(`state ${stateFile}: ${earlier.length} earlier results`);
    // `--dump-drafts` (dev and week only): one JSON line per new result with the mail, the draft and the grade, for tuning.
    // The results of an earlier run are not in it: they hold no text.
    const dumpFile = options["dump-drafts"];
    const drafts = new Map<string, string>();
    const caseById = new Map(cases.map((c) => [c.id, c]));
    const outcome = await runPool<EvalCase, DrafterCaseResult>({
      cases,
      earlier: new Map(earlier.map((r) => [r.id, r])),
      concurrency: options.concurrency,
      budget:
        cap === null
          ? undefined
          : {
              capUsd: cap,
              callCostUsd: (usage, at) =>
                costPerMail(usage.model, usage.tokensIn, usage.tokensOut, at, endpointOfModel(usage.model)),
              firstEstimateUsd: estimateUsd,
              onSpend: (usd) => {
                newSpendUsd += usd;
              },
            },
      stopAfterErrors: STOP_AFTER_ERRORS,
      errorStopReason: ERROR_STOP_REASON,
      now: startedAt,
      usesLlm: (c) => c.lang === "pl" || c.lang === "en",
      run: (c, attempts) =>
        runDrafterCase(
          {
            llm,
            sleep: deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
            ...(judgeRow === undefined ? {} : { judge: { llm, model: judgeRow.model, prompt: judgePrompt } }),
            ...(dumpFile === undefined ? {} : { onDraft: (id: string, body: string) => drafts.set(id, body) }),
          },
          c,
          { persona, retries: options.retries, referenceStyle: source.referenceStyle, prompt: drafterPrompt },
          attempts
        ),
      onResult: async (result) => {
        appendFileSync(stateFile, `${JSON.stringify(result)}\n`);
        if (dumpFile !== undefined)
          appendFileSync(
            dumpFile,
            `${JSON.stringify(dumpLine(result, caseById.get(result.id), drafts.get(result.id)))}\n`
          );
        // The incoming ids of a holdout never reach the output: a failed line holds the code only.
        if (result.errorCode !== null) cli.print(`case ${holdout ? "-" : result.id} failed: ${result.errorCode}`);
      },
    });

    const results = cases.flatMap((c) => outcome.results.get(c.id) ?? []);
    const scores = scoreDrafter(results, {
      judgeRan: options.judge,
      planted: (id) => plantedIds.has(id),
      languageOf: (id) => languageById.get(id) ?? "other",
    });
    const complete = outcome.stoppedReason === null && results.length === cases.length;
    const header: DrafterReportHeader = {
      title: `Reply drafter eval: ${runKey}`,
      data: source.data,
      provider: row.provider,
      endpoint,
      host,
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      promptVersion: drafterPrompt.version,
      judge:
        judgeRow === undefined
          ? null
          : { provider: judgeRow.provider, model: judgeRow.model, promptVersion: judgePrompt.version },
      style: styleHeader(style),
      planned: cases.length,
      complete,
      stoppedReason: outcome.stoppedReason,
      spentUsd: outcome.spentUsd,
      capUsd: cap,
      date: startedAt.toISOString().slice(0, 10),
    };
    const injection = options.set === "reply-injection" ? injectionSummary(results) : undefined;
    // Case ids appear for tuning data only: the dev part and the dev-only commitment set.
    const listIds = options.part === "dev" || options.set === "reply-commitment";
    const markdown =
      injection === undefined
        ? renderSimDrafterReport({
            header,
            scores,
            ...(listIds
              ? {
                  ids: {
                    failed: results.filter((r) => r.outcome === "failed" || r.outcome === "error").map((r) => r.id),
                    notAsIs: results.filter((r) => r.outcome === "draft" && !sendAsIs(r)).map((r) => r.id),
                    commitment: results
                      .filter(
                        (r) =>
                          r.judge !== null && "checks" in r.judge && r.judge.checks.no_invented_commitment === false
                      )
                      .map((r) => r.id),
                  },
                }
              : {}),
          })
        : renderInjectionReport({
            header,
            scores,
            summary: injection,
            notPassed: results.filter((r) => injectionVerdict(r) !== true).map((r) => r.id),
          });
    cli.write(`${markdown}\n`);
    if (options.out !== undefined) writeFileSync(options.out, markdown);

    const gateRun = gateCheck({
      source,
      holdout,
      limited: options.limit !== undefined,
      complete,
      judged: judgeRow !== undefined,
      styled: style.kind !== "scenario",
    });
    let gate = false;
    if ("skip" in gateRun) {
      cli.print(gateRun.skip);
    } else if (header.judge !== null) {
      const written = writeDrafterGate({
        source: gateRun.source,
        scores,
        header: { ...header, judge: header.judge },
        endpoint,
        dir: deps.gateDir ?? gateDir,
      });
      cli.print(`gate file: evals/results/gate/${written.name} passed=${written.passed}`);
      gate = true;
    }

    const code = drafterExitCode({ complete, scores, gate, injection });
    if (!complete) cli.fail(`${outcome.stoppedReason ?? "run not complete"}: resume with the same command`);
    else if (scores.errors > scores.cases * 0.1)
      cli.fail(`${scores.errors} error cases of ${scores.cases}: more than 10%`);
    else if (code === 1) cli.fail("a bar of the drafter eval failed: see the report");
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
      ledgerLine({ runId: randomUUID(), at: new Date(), usd: newSpendUsd, label: `drafter-${runKey}-${row.model}` })
    );
    release();
  }
}
