import { join } from "node:path";

import { defineConfig } from "@playwright/test";

import { DOCS_BASE } from "@ea/core";

import { docsLocalOrigin } from "./site";

// The browser check of the built docs site: Chromium only (Firefox and Safari stay open).
// The build must exist first: `bun run docs:build`.
const chromiumPath = process.env.CHROMIUM_PATH;
const remote = Boolean(process.env.DOCS_TEST_URL?.trim());

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  workers: 1,
  reporter: "line",
  outputDir: "test-results",
  use: {
    trace: "retain-on-failure",
    // The developer's system Chromium; unset in CI, which installs Playwright's own.
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
  projects: [{ name: "desktop", use: { viewport: { width: 1280, height: 800 } } }],
  // With `DOCS_TEST_URL` the tests open that site and start no server.
  webServer: remote
    ? undefined
    : {
        command: "bun apps/docs/e2e/serve.ts",
        cwd: join(import.meta.dirname, "../../.."),
        url: `${docsLocalOrigin(process.env)}${DOCS_BASE}/`,
        // A server that already holds the port could serve another build: fail instead of reuse.
        reuseExistingServer: false,
        timeout: 30_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
