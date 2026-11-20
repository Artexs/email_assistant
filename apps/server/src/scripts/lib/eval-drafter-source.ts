import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type EvalCase, evalCaseSchema } from "@ea/core";
import { z } from "zod";

import { type DrafterCaseResult, type DrafterPersona, INJECTION_PERSONA } from "../../modules/replies";
import { corpusDir, readScenario } from "../../platform/sim-files";
import type { EvalOptions } from "../eval-args";

import { loadSimCases } from "./eval-sim-load";

const simRoot = resolve(import.meta.dir, "../../../../../evals/sim");
const injectionFile = resolve(import.meta.dir, "../../../../../evals/cases/reply-injection.json");
const commitmentFile = resolve(import.meta.dir, "../../../../../evals/cases/reply-commitment.json");

// What a test replaces: the paths of the data.
export interface SourceFiles {
  root?: string;
  injectionFile?: string;
  commitmentFile?: string;
}

export interface Source {
  cases: EvalCase[];
  persona: DrafterPersona;
  // The name of the data in the state file name, the report and the ledger label.
  key: string;
  data: string;
  scenario?: string;
  version?: string;
  manifestSha?: string | null;
}

// The needs_reply cases of an incoming part, with the persona of the corpus executive; or one reply set (injection, or
// the dev-only commitment traps) with a fixed persona.
export async function loadSource(options: EvalOptions, deps: SourceFiles): Promise<Source> {
  if (options.sim === undefined) {
    const commitment = options.set === "reply-commitment";
    const file = commitment ? (deps.commitmentFile ?? commitmentFile) : (deps.injectionFile ?? injectionFile);
    const cases = z.array(evalCaseSchema).parse(JSON.parse(readFileSync(file, "utf8")));
    return {
      cases,
      persona: INJECTION_PERSONA,
      key: commitment ? "reply-commitment" : "reply-injection",
      data: `${commitment ? "reply commitment set (dev only)" : "reply injection set"}, ${cases.length} cases`,
    };
  }
  const scenario = options.sim;
  const part = options.part as NonNullable<EvalOptions["part"]>;
  const root = deps.root ?? simRoot;
  const loaded = await loadSimCases({ root, scenario, part, requireManifest: part === "holdout" });
  const { executive } = readScenario(corpusDir(scenario, root));
  return {
    cases: loaded.cases,
    persona: {
      displayName: executive.displayName,
      signature: executive.signature,
      writingStyle: executive.voice,
      timeZone: executive.timeZone,
    },
    key: `sim-${scenario}-v${loaded.version}-${part}`,
    data: `corpus ${scenario} v${loaded.version} part ${part}, manifest ${loaded.manifestSha?.slice(0, 12) ?? "none (not frozen)"}, owner audit ${loaded.audit}`,
    scenario,
    version: loaded.version,
    manifestSha: loaded.manifestSha,
  };
}

// One line of `--dump-drafts`: the dev or week case, its draft and its grade. Both parts are made-up tuning data; the
// holdout never gets here.
export function dumpLine(result: DrafterCaseResult, c: EvalCase | undefined, draft: string | undefined) {
  return {
    id: result.id,
    lang: c?.lang,
    from: c?.from,
    subject: c?.subject,
    body: c?.body,
    thread: c?.thread,
    expectedPoints: c?.sim?.expectedPoints ?? [],
    mustNot: c?.sim?.mustNot ?? [],
    outcome: result.outcome,
    reasonCode: result.reasonCode,
    failures: result.failures,
    draft: draft ?? null,
    judge: result.judge,
  };
}
