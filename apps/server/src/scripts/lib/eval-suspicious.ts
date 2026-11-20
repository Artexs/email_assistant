import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Scenario } from "@ea/core";

import { renderSuspiciousReport, suspiciousRows } from "../../modules/triage";
import { createCliOutput } from "../../platform/cli";
import { createLog } from "../../platform/log";
import { corpusDir, readScenario } from "../../platform/sim-files";
import type { EvalOptions } from "../eval-args";

import { HOLDOUT_NEEDS_FREEZE, loadSimCases } from "./eval-sim-load";

// `eval --suspicious`: the suspicious-mail rules on a sim corpus part. No LLM, no key, no spend.

const log = createLog("eval");
const cli = createCliOutput("eval");

const simRoot = resolve(import.meta.dir, "../../../../../evals/sim");

export interface SuspiciousDeps {
  root?: string;
  now?: () => Date;
  write?: (text: string) => void;
}

export async function runSuspicious(options: EvalOptions, deps: SuspiciousDeps = {}): Promise<number> {
  const scenarioId = options.sim as string;
  const part = options.part as NonNullable<EvalOptions["part"]>;
  const root = deps.root ?? simRoot;
  let loaded: Awaited<ReturnType<typeof loadSimCases>>;
  let scenario: Scenario;
  try {
    loaded = await loadSimCases({ root, scenario: scenarioId, part, requireManifest: part === "holdout" });
    scenario = readScenario(corpusDir(scenarioId, root));
  } catch (error) {
    if (error instanceof Error && error.message === HOLDOUT_NEEDS_FREEZE) cli.fail(HOLDOUT_NEEDS_FREEZE);
    else log.error("corpus_load_failed");
    return 1;
  }
  const markdown = renderSuspiciousReport({
    rows: suspiciousRows(loaded.cases, scenario, loaded.htmlById),
    corpus: {
      scenario: scenarioId,
      version: loaded.version,
      part,
      manifestSha: loaded.manifestSha,
      audit: loaded.audit,
    },
    date: (deps.now ?? (() => new Date()))().toISOString().slice(0, 10),
    listIds: part === "dev",
  });
  (deps.write ?? ((text: string) => cli.write(`${text}\n`)))(markdown);
  if (options.out !== undefined) writeFileSync(options.out, markdown);
  return 0;
}
