import { defineConfig } from "@playwright/test";

import { E2E_BASE_URL, e2eEnv, loadDotEnv } from "./env";
import { e2eLaunchOptions, e2eWebServers } from "./servers";
import { MINUTE_MS } from "@ea/core";

// The contact sheet: `bun run ui:sheet` shoots every route of `ui-sheet/routes.ts` in each viewport, colour scheme and language, and writes the
// pictures and `index.html` outside the worktree (`ui-sheet/dir.ts`). It records and never judges: no pixel comparison, no CI job.
// It uses the web servers, the seed and the env of the panel e2e config, with its own test folder, output folder and global setup.
loadDotEnv();
// Fails with the setup command, or with `refusing: <reason>` for a database the seed would wipe, before any command runs.
const env = e2eEnv();

export default defineConfig({
  testDir: "./ui-sheet",
  testMatch: "sheet.spec.ts",
  globalSetup: "./ui-sheet/global-setup.ts",
  // One row takes eight shots and a 320 px check.
  timeout: 3 * MINUTE_MS,
  expect: { timeout: 15_000 },
  retries: 0,
  // One sign-in for each state, and the rows of a state share it: one test at a time, in file order (the last test writes the index).
  workers: 1,
  reporter: "line",
  outputDir: "test-results/ui-sheet",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "off",
    launchOptions: e2eLaunchOptions(),
  },
  // No project: each shot makes its own context (desktop 1280x800 or the Pixel 7 device).
  webServer: e2eWebServers(env),
});
