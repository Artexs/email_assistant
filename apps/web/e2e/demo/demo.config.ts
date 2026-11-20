import { defineConfig } from "@playwright/test";

import { E2E_BASE_URL, e2eEnv, loadDotEnv } from "../env";
import { demoDbProblem } from "../lib/demo/db-guard";
import { DEMO_VIEWPORT } from "../lib/demo/record-args";
import { e2eLaunchOptions, e2eWebServers } from "../servers";

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
const env = e2eEnv();

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./global-setup.ts",
  timeout: 10 * 60_000,
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
