import { readFileSync } from "node:fs";

import { defineConfig } from "@playwright/test";

import { E2E_BASE_URL, e2eEnv, loadDotEnv } from "../env";
import { demoDbProblem } from "../lib/demo/db-guard";
import { DEMO_VIEWPORT } from "../lib/demo/record-args";
import type { DemoRunPlan } from "../lib/demo/run-plan";
import { assertLoopbackLlm, demoServerEnv, demoTestTimeoutMs } from "../lib/demo/server-env";
import { shotSource } from "../lib/shot-source";
import { e2eLaunchOptions, e2eWebServers } from "../servers";
import { MINUTE_MS } from "@ea/core";

// The recording run of the demo video: `bun run demo:record` starts it (the command rebuilds the demo database first, then runs ffmpeg on
// the result). The servers, the seed and the env are those of the panel e2e run (`servers.ts`, `env.ts`) with one change: the database is the
// demo database (`DEMO_DATABASE_URL`, `DEMO_MIGRATOR_DATABASE_URL`). The e2e env keys point there before `e2eEnv()` reads them, so
// the seed, the server and the CLI scripts of the spec all use it. `bun run test:e2e` (`testDir: ./tests`) never runs this folder.
// Run it only through the command, under `flock /tmp/email-assistant-shared-tests.lock` (fixed ports, one shared GreenMail).
loadDotEnv();
const demoApp = process.env.DEMO_DATABASE_URL ?? "";
const demoMigrator = process.env.DEMO_MIGRATOR_DATABASE_URL ?? "";
if (demoApp === "" || demoMigrator === "") throw new Error("demo_db_missing");
// The runner loads this file, and each worker loads it again with the changed env: the check and the change run once.
if (process.env.DEMO_DB_CHECKED !== demoApp) {
  const others = [process.env.DATABASE_URL, process.env.E2E_DATABASE_URL, process.env.E2E_MIGRATOR_DATABASE_URL];
  if (demoDbProblem(demoApp, others) !== null || demoDbProblem(demoMigrator, others) !== null) {
    throw new Error("demo_db_refused");
  }
  process.env.E2E_DATABASE_URL = demoApp;
  process.env.E2E_MIGRATOR_DATABASE_URL = demoMigrator;
  process.env.DEMO_DB_CHECKED = demoApp;
}

// The demo source runs the replay of the demo week as its one model: `record.ts` wrote the plan and started the replay server, and the
// servers get an env that reaches no other model. The e2e source keeps the e2e env and its 10 minutes.
const demoSource = shotSource().kind === "demo";
function demoEnv(): Record<string, string> {
  const planFile = process.env.DEMO_PLAN_FILE ?? "";
  const replayPort = Number(process.env.DEMO_REPLAY_PORT);
  const gateDir = process.env.DEMO_GATE_DIR ?? "";
  if (planFile === "" || gateDir === "" || !Number.isInteger(replayPort) || replayPort <= 0) {
    throw new Error("demo_replay_missing: run bun run demo:record");
  }
  const plan = JSON.parse(readFileSync(planFile, "utf8")) as DemoRunPlan;
  const withReplay = demoServerEnv(e2eEnv(), {
    replayPort,
    model: plan.model,
    gateDir,
    sendTestAddress: plan.delegation.delegateAddress,
  });
  // Right before the servers start: a key in the developer `.env` must not reach a model that is not the replay.
  assertLoopbackLlm(withReplay);
  return withReplay;
}
const env = demoSource ? demoEnv() : e2eEnv();

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./global-setup.ts",
  timeout: demoSource ? demoTestTimeoutMs() : 10 * MINUTE_MS,
  expect: { timeout: 20_000 },
  retries: 0,
  // One recording, one page: the steps run in order.
  workers: 1,
  reporter: "line",
  outputDir: "../test-results/demo",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "off",
    viewport: { ...DEMO_VIEWPORT },
    // A click that cannot happen fails after 30 s with its locator, not after the 10 minutes of the test.
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    launchOptions: e2eLaunchOptions(),
  },
  webServer: e2eWebServers(env),
});
