import { defineConfig } from "@playwright/test";

import { E2E_BASE_URL, e2eEnv, loadDotEnv } from "./env";
import { e2eLaunchOptions, e2eWebServers } from "./servers";
import { MINUTE_MS } from "@ea/core";

// The shot run of the docs site: `bun run docs:shots` makes `apps/docs/public/shots/<name>.png` from the e2e seed.
// It uses the web servers, the seed and the env of the panel e2e config (`servers.ts`, `global-setup.ts`), but its own test folder:
// `bun run test:e2e` (`testDir: ./tests`) never runs this spec. The ports come from `env.ts`; the run needs no lock.
loadDotEnv();
// Fails with the setup command, or with `refusing: <reason>` for a database the seed would wipe, before any command runs.
const env = e2eEnv();

export default defineConfig({
  testDir: "./docs-shots",
  globalSetup: "./docs-shots/global-setup.ts",
  timeout: MINUTE_MS,
  expect: { timeout: 10_000 },
  retries: 0,
  // One signed-in owner and one fixed organization: one test at a time, in file order (the last test checks the files).
  workers: 1,
  reporter: "line",
  outputDir: "test-results/docs-shots",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "off",
    launchOptions: e2eLaunchOptions(),
  },
  // No project: each shot makes its own context (desktop 1280x800 or the Pixel 7 device).
  webServer: e2eWebServers(env),
});
