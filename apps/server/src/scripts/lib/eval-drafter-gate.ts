import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { LlmEndpointKind } from "@ea/core";

import { buildDrafterGateFile, type DrafterReportHeader, type DrafterScores } from "../../modules/replies";
import { gateFileName } from "../../modules/triage";

import type { Source } from "./eval-drafter-source";

export type GateSource = Source & { scenario: string; version: string; manifestSha: string };

// The gate file comes from a full, judged holdout run only. Returns the source of the run when it may write the file,
// else the line that says why not.
export function gateCheck(input: {
  source: Source;
  holdout: boolean;
  limited: boolean;
  complete: boolean;
  judged: boolean;
}): { source: GateSource } | { skip: string } {
  const { source } = input;
  if (source.scenario === undefined) return { skip: `no gate file: the ${source.key} set is not a holdout` };
  if (!input.holdout) return { skip: "no gate file: part is not holdout" };
  if (input.limited) return { skip: "no gate file: --limit is set" };
  if (!input.complete || !input.judged || !source.manifestSha || source.version === undefined) {
    return { skip: "no gate file: the run is not complete or has no judge" };
  }
  return { source: { ...source, scenario: source.scenario, version: source.version, manifestSha: source.manifestSha } };
}

// Writes the gate file of a run that `gateCheck` let through; returns its name and the verdict.
export function writeDrafterGate(input: {
  source: GateSource;
  scores: DrafterScores;
  header: DrafterReportHeader & { judge: NonNullable<DrafterReportHeader["judge"]> };
  endpoint: LlmEndpointKind;
  dir: string;
}): { name: string; passed: boolean } {
  const { source, header } = input;
  const name = gateFileName({
    role: "drafter",
    endpoint: input.endpoint,
    promptVersion: header.promptVersion,
    model: header.model,
    reasoningEffort: header.reasoningEffort,
    scenario: source.scenario,
    version: source.version,
  });
  const file = buildDrafterGateFile(input.scores, {
    scenario: source.scenario,
    version: source.version,
    manifestSha: source.manifestSha,
    header,
    judge: header.judge,
    now: new Date(),
  });
  mkdirSync(input.dir, { recursive: true });
  writeFileSync(resolve(input.dir, name), `${JSON.stringify(file, null, 2)}\n`);
  return { name, passed: file.passed };
}
