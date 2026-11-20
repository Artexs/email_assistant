import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildStyleSamples, STYLE_MIN_SAMPLES, type SentPart, type UserLocale } from "@ea/core";
import { type z } from "zod";

import {
  renderStyleReport,
  type SentBankMail,
  styleSourcesOf,
  StylistCallError,
  suggestStyle,
} from "../../modules/replies";
import { createCliOutput } from "../../platform/cli";
import { llmErrorCode } from "../../platform/llm";
import { corpusDir, readScenario } from "../../platform/sim-files";
import { readSentManifest, sentEvalCasesOf } from "../../platform/sim-sent-files";
import { type EvalOptions } from "../eval-args";
import { STYLE_INJECTION_SET } from "../eval-args-stylist";

import { loadEvalConfig } from "./eval-config";
import { type styleFileSchema } from "./eval-drafter-style";
import { runStyleInjection } from "./eval-stylist-injection";
import {
  attemptsUsd,
  callsLeft,
  fileSafe,
  recordSpend,
  type StylistEvalDeps,
  type StylistRunContext,
  stylistSetup,
} from "./eval-stylist-setup";

export type { StylistEvalDeps } from "./eval-stylist-setup";

const cli = createCliOutput("eval");

const simRoot = resolve(import.meta.dir, "../../../../../evals/sim");
export const stylesDir = resolve(import.meta.dir, "../../../../../evals/results/styles");

type StyleFile = z.infer<typeof styleFileSchema>;

// `eval --sim <scenario> --part sent-dev|sent-holdout --stylist` and `eval --set style-injection --stylist`: the
// style suggestion that production runs (same samples, prompt, schema, checks and retry), on the made-up sent mail
// of the sim corpus. Exit 0: the style text passed its checks (the injection set: every case passed); 1: a setup
// error, too few samples, a failed check or a provider error; 2: a run flag the provider does not take; 4: the budget
// cap stopped the run.
export async function runStylistEval(options: EvalOptions, deps: StylistEvalDeps = {}): Promise<number> {
  const config = deps.config ?? loadEvalConfig();
  if (config === null) return 1;
  const context = stylistSetup(options, deps, config);
  if (typeof context === "number") return context;
  const outDir = deps.stylesDir ?? stylesDir;
  if (options.set === STYLE_INJECTION_SET) return runStyleInjection(options, context, { dir: outDir, deps });
  return runStylePart(options, context, { dir: outDir, deps });
}

async function runStylePart(
  options: EvalOptions,
  context: StylistRunContext,
  where: { dir: string; deps: StylistEvalDeps }
): Promise<number> {
  const scenarioId = options.sim as string;
  const part = options.sentPart as SentPart;
  const holdout = part === "sent-holdout";
  const root = where.deps.root ?? simRoot;
  const dir = corpusDir(scenarioId, root);
  if (holdout && readSentManifest(dir) === undefined) {
    cli.fail("holdout needs a frozen corpus: run sim freeze --bank sent");
    return 1;
  }
  let mails: SentBankMail[];
  let executive: { lang: UserLocale; signature: string };
  try {
    executive = readScenario(dir).executive;
    mails = sentEvalCasesOf(root, scenarioId, part, { holdout }).map((c) => c.blind);
  } catch (error) {
    cli.fail(`corpus load failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return 1;
  }
  const sources = styleSourcesOf(mails);
  const built = buildStyleSamples(sources, { signature: executive.signature === "" ? null : executive.signature });
  if (built.samples.length < STYLE_MIN_SAMPLES) {
    cli.fail(`${built.samples.length} usable samples, at least ${STYLE_MIN_SAMPLES} needed: no call made`);
    return 1;
  }
  cli.print(`corpus ${scenarioId} part ${part}: ${sources.length} sources, ${built.samples.length} samples`);
  cli.print(context.header);

  const maxCalls = callsLeft(context, 0);
  if (maxCalls < 1) {
    cli.fail("the budget cap is below the price of one call");
    return 4;
  }
  const label = `stylist:${part}`;
  let spentUsd = 0;
  try {
    const result = await suggestStyle(
      context.llm,
      { samples: built.samples, names: built.names, language: executive.lang },
      { maxCalls, prompt: context.prompt }
    );
    spentUsd = attemptsUsd(context, result.attempts);
    const checks =
      result.kind === "suggestion"
        ? { ok: true, failures: [] as string[] }
        : { ok: false, failures: result.reason === "checks" ? [...result.failures] : ["output"] };
    const text = result.kind === "suggestion" ? result.text : "";
    const file: StyleFile = {
      scenario: scenarioId,
      part,
      promptVersion: context.prompt.version,
      model: context.model,
      effort: context.effort,
      sampleCount: built.samples.length,
      text,
      checks,
      usd: spentUsd,
    };
    mkdirSync(where.dir, { recursive: true });
    const name = `${fileSafe(`${scenarioId}-${part}-${context.prompt.version}-${context.model}-${context.effort ?? "none"}`)}.json`;
    writeFileSync(resolve(where.dir, name), `${JSON.stringify(file, null, 2)}\n`);
    const markdown = renderStyleReport({
      title: `Stylist eval: sim ${scenarioId} ${part}`,
      date: context.startedAt.toISOString().slice(0, 10),
      scenario: scenarioId,
      part,
      provider: context.provider,
      endpoint: context.endpoint,
      host: context.host,
      model: context.model,
      reasoningEffort: context.effort,
      promptVersion: context.prompt.version,
      sourceCount: sources.length,
      sampleCount: built.samples.length,
      checks,
      text,
      calls: result.attempts.length,
      spentUsd,
      capUsd: context.capUsd,
    });
    cli.write(`${markdown}\n`);
    if (options.out !== undefined) writeFileSync(options.out, markdown);
    cli.print(`style file: evals/results/styles/${name}`);
    if (!checks.ok) {
      cli.fail("the style text failed its checks: see the report");
      return 1;
    }
    return 0;
  } catch (error) {
    if (!(error instanceof StylistCallError)) throw error;
    spentUsd = attemptsUsd(context, error.attempts);
    cli.fail(`provider error ${llmErrorCode(error.cause)}`);
    return 1;
  } finally {
    recordSpend(context, label, spentUsd);
  }
}
