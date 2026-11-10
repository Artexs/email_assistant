import { defineConfig, devices } from "@playwright/test";

import { E2E_BASE_URL, e2eEnv, loadDotEnv, repoRoot } from "./env";

loadDotEnv();
// Fails with the setup command, or with `refusing: <reason>` for a database the seed would wipe, before any command runs.
const env = e2eEnv();
const chromiumPath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  // The seed is one fixed organization and the specs change its state: one test at a time, the projects one after the other.
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "line",
  outputDir: "test-results",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    // The developer's system Chromium; unset in CI, which installs Playwright's own.
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    // Playwright starts the server before the global setup, and Better Auth keeps a schema mismatch it sees at
    // start until a restart: so the server command migrates first.
    command: "bun run db:migrate && bun apps/server/src/main.ts",
    cwd: repoRoot,
    url: `${E2E_BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env,
    stdout: "pipe",
    stderr: "pipe",
  },
});
