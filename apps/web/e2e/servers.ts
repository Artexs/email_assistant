import type { PlaywrightTestConfig } from "@playwright/test";

import { E2E_BASE_URL, E2E_TELEGRAM_PORT, E2E_TELEGRAM_URL, repoRoot } from "./env";
import { MINUTE_MS } from "@ea/core";

// The web servers of the panel e2e run, shared by `playwright.config.ts` and `docs-shots.config.ts`: the docs shot run
// uses the same fake Telegram, the same server, the same seed and the same env, so both read the one definition. `env` is `e2eEnv()`.
export function e2eWebServers(env: Record<string, string>): NonNullable<PlaywrightTestConfig["webServer"]> {
  return [
    {
      command: `bun tools/fake-telegram/src/cli.ts serve --port ${E2E_TELEGRAM_PORT}`,
      cwd: repoRoot,
      url: `${E2E_TELEGRAM_URL}/_fake/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Playwright starts the server before the global setup, and Better Auth keeps a schema mismatch it sees at
      // start until a restart: so the server command migrates first.
      command: "bun run db:migrate && bun apps/server/src/main.ts",
      cwd: repoRoot,
      url: `${E2E_BASE_URL}/health`,
      reuseExistingServer: false,
      timeout: MINUTE_MS,
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  ];
}

// The developer's system Chromium; unset in CI, which installs Playwright's own.
export function e2eLaunchOptions(): { executablePath?: string } {
  const chromiumPath = process.env.CHROMIUM_PATH;
  return chromiumPath ? { executablePath: chromiumPath } : {};
}
