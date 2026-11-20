import { resolve } from "node:path";

import { runExtractorEvalRun } from "../../modules/loops";
import { createCliOutput } from "../../platform/cli";
import type { Config } from "../../platform/config";
import type { createLlmClient } from "../../platform/llm";
import { type EvalOptions, evalUsage } from "../eval-args";

import { loadEvalConfig } from "./eval-config";

const cli = createCliOutput("eval");

const simRoot = resolve(import.meta.dir, "../../../../../evals/sim");
const runsDir = resolve(import.meta.dir, "../../../../../evals/.runs");
const gateDir = resolve(import.meta.dir, "../../../../../evals/results/gate");

// What a test replaces: the CLI passes none of them.
export interface ExtractorEvalCliDeps {
  config?: Config;
  createLlmClient?: typeof createLlmClient;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  root?: string;
  runsDir?: string;
  gateDir?: string;
}

// `eval --sim <scenario> --part sent-dev|sent-holdout --extractor`: load the config, call `runExtractorEvalRun`, print.
// Exit 0: done (and the gate passed, on the holdout); 1: a setup error, a failed gate, or over 10% error cases;
// 2: a run flag the provider does not take; 4: the run stopped (cap or errors), resume it.
export async function runExtractorEval(options: EvalOptions, deps: ExtractorEvalCliDeps = {}): Promise<number> {
  const config = deps.config ?? loadEvalConfig();
  if (config === null) return 1;
  return runExtractorEvalRun(
    options,
    {
      config,
      root: deps.root ?? simRoot,
      runsDir: deps.runsDir ?? runsDir,
      gateDir: deps.gateDir ?? gateDir,
      usage: evalUsage,
      ledgerEnv: { XDG_STATE_HOME: process.env.XDG_STATE_HOME, HOME: process.env.HOME },
      ...(deps.createLlmClient === undefined ? {} : { createLlmClient: deps.createLlmClient }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
    },
    {
      print: (text) => cli.print(text),
      fail: (text) => cli.fail(text),
      raw: (text) => cli.write(`${text}\n`),
    }
  );
}
