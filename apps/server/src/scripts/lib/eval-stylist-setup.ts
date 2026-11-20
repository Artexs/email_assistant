import { randomUUID } from "node:crypto";

import { costPerMail, type LlmEndpointKind } from "@ea/core";

import { STYLIST_MAX_CALLS, type StylistAttempt } from "../../modules/replies";
import { firstEstimateUsd, prompts, type StylistPrompt, stylistVersions } from "../../modules/triage";
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
  appendLedgerLine,
  defaultLedgerPath,
  ledgerLine,
  MONTH_CAP_USD,
  monthOf,
  monthSpend,
  readLedger,
  runCap,
} from "../../platform/eval-ledger";
import { createLlmClient, llmEndpointFields, type LlmClient, type LlmRoleTable } from "../../platform/llm";
import { type EvalOptions, evalUsage } from "../eval-args";

const cli = createCliOutput("eval");

// What a test replaces: the CLI passes none of them.
export interface StylistEvalDeps {
  config?: Config;
  createLlmClient?: typeof createLlmClient;
  now?: () => Date;
  root?: string;
  stylesDir?: string;
  casesFile?: string;
}

/** What both stylist runs share: the model row, the client, the price check and the spend cap. */
export interface StylistRunContext {
  llm: LlmClient;
  prompt: StylistPrompt;
  provider: string;
  model: string;
  effort: string | null;
  endpoint: LlmEndpointKind;
  host: string | null;
  startedAt: Date;
  estimateUsd: number;
  // Null: an own endpoint, no budget.
  capUsd: number | null;
  ledgerPath: string;
  header: string;
}

// A number is the exit code of a setup error; the message is printed.
export function stylistSetup(options: EvalOptions, deps: StylistEvalDeps, config: Config): StylistRunContext | number {
  let table: LlmRoleTable;
  try {
    table = llmRoleTable(
      config,
      runOverrides("stylist", {
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
  const row = table.roles.stylist;
  const keys = table.providers[row.provider];
  if (keys.apiKey === undefined) {
    cli.fail(`${keys.apiKeyName} is missing`);
    return 1;
  }
  const prompt = options["stylist-prompt"] === undefined ? prompts.stylist : stylistVersions[options["stylist-prompt"]];
  const { endpoint, host } = llmEndpointFields(table, "stylist");
  // An own server costs nothing and has no price row: the run takes no budget.
  const own = endpoint === "own";
  const startedAt = (deps.now ?? (() => new Date()))();
  const estimateUsd = own ? 0 : firstEstimateUsd(row.model, startedAt, endpoint);
  if (estimateUsd === null) {
    cli.fail(`no price for model ${row.model}: add it to llmPrices before a stylist run`);
    return 1;
  }
  let ledgerPath: string;
  try {
    ledgerPath =
      options["spend-ledger"] ??
      defaultLedgerPath({ XDG_STATE_HOME: process.env.XDG_STATE_HOME, HOME: process.env.HOME });
  } catch (error) {
    cli.fail(error instanceof Error ? error.message : "no ledger path");
    return 1;
  }
  const capUsd = own
    ? null
    : runCap({
        requested: options.budgetUsd,
        monthSpent: monthSpend(readLedger(ledgerPath), monthOf(startedAt)),
        monthCap: MONTH_CAP_USD,
      });
  if (capUsd !== null && capUsd <= 0) {
    cli.fail("month budget used");
    return 1;
  }
  const header = `provider=${row.provider} endpoint=${endpoint} host=${host ?? "-"} model=${row.model} effort=${row.reasoningEffort ?? "-"} prompt=${prompt.version} cap=${capUsd === null ? "none (own endpoint)" : `$${capUsd}`}`;
  return {
    llm: (deps.createLlmClient ?? createLlmClient)({ table }),
    prompt,
    provider: row.provider,
    model: row.model,
    effort: row.reasoningEffort,
    endpoint,
    host,
    startedAt,
    estimateUsd,
    capUsd,
    ledgerPath,
    header,
  };
}

/** The calls that the rest of the budget pays for (0 to 2). The estimate is the price of a first call. */
export function callsLeft(context: StylistRunContext, spentUsd: number): number {
  if (context.capUsd === null) return STYLIST_MAX_CALLS;
  return Math.min(STYLIST_MAX_CALLS, Math.floor((context.capUsd - spentUsd) / context.estimateUsd));
}

/** The cost of the calls that gave token counts. */
export function attemptsUsd(context: StylistRunContext, attempts: readonly StylistAttempt[]): number {
  return attempts.reduce(
    (sum, attempt) =>
      attempt.usage === null
        ? sum
        : sum +
          (costPerMail(
            attempt.usage.model,
            attempt.usage.tokensIn,
            attempt.usage.tokensOut,
            context.startedAt,
            context.endpoint
          ) ?? 0),
    0
  );
}

/** A file-name part: the characters that a path can hold. */
export const fileSafe = (text: string): string => text.replace(/[^\w.-]/g, "_");

// One ledger line per run that reached a call, also after an error: the new spend only.
export function recordSpend(context: StylistRunContext, label: string, usd: number): void {
  appendLedgerLine(
    context.ledgerPath,
    ledgerLine({ runId: randomUUID(), at: new Date(), usd, label: `${label}-${context.model}` })
  );
}
