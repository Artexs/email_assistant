import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { DemoSeedError, parseDemoSeed, readSeedFile } from "../../../../server/src/modules/lab";
import { prompts } from "../../../../server/src/modules/triage";
import { buildReplayTable, startReplayServer, type ReplayServer } from "../../../../../tools/llm-replay/src";
import { readClassifierGates, writeGateDir } from "./gate-files";
import { bestGate, demoGateCopy, type DemoRunPlan, planDemoRun } from "./run-plan";

const COMMITTED_GATE_DIR = resolve(import.meta.dirname, "../../../../../evals/results/gate");
const REPLAY_HOST = "127.0.0.1";

/** What the demo source needs before the servers start: the plan, the gate copy and the running replay server. */
export interface DemoPrepared {
  plan: DemoRunPlan;
  replay: ReplayServer;
  planFile: string;
  gateDir: string;
  /** True when the committed gate file behind the copy is provisional: the video is no upload candidate. */
  gateProvisional: boolean;
}

/**
 * Checks the seed and plans the run. Each refusal is a code that the command prints before any database changes or server starts.
 * On success the replay server runs; the caller stops it.
 */
export async function prepareDemoRun(seedFile: string, work: string): Promise<DemoPrepared | string> {
  const text = readSeedFile(seedFile);
  if (text === undefined) return "seed_missing";
  let seed;
  try {
    seed = parseDemoSeed(text);
  } catch (error) {
    if (error instanceof DemoSeedError) return `demo_seed_invalid ${error.code}`;
    throw error;
  }
  const gates = readClassifierGates(COMMITTED_GATE_DIR);
  const planned = planDemoRun(seed, gates, prompts.classifier.version);
  if (!planned.ok) return planned.code;
  const { plan } = planned;

  // `planDemoRun` found a file for this model and prompt, so `bestGate` finds the same one.
  const source = bestGate(gates, plan.model, plan.promptVersion);
  if (source === undefined) return "demo_gate_missing";
  const copy = demoGateCopy(source, { model: plan.model, host: REPLAY_HOST });
  const gateDir = join(work, "gate");
  writeGateDir(gateDir, copy);

  const replay = await startReplayServer(buildReplayTable(seed), { port: 0 });
  const planFile = join(work, "demo-plan.json");
  writeFileSync(planFile, JSON.stringify(plan));
  return { plan, replay, planFile, gateDir, gateProvisional: copy.sourceProvisional };
}
