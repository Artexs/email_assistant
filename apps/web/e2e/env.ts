import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { seedTargetOk } from "../../server/src/scripts/e2e-seed-args";

// The one place that knows the e2e environment: the port, the base URL, the fixed secret and the server env.
export const E2E_PORT = 8081;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
// A test value, not a secret (WEB_AUTH_SECRET needs 32 characters).
export const E2E_SECRET = "e2e-web-auth-secret-0123456789abcdefghij";

export const repoRoot = resolve(import.meta.dirname, "../../..");

const missingMessage =
  "set E2E_DATABASE_URL and E2E_MIGRATOR_DATABASE_URL: run bun run db:worktree e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env";

// Playwright runs on Node, which loads no `.env` by itself (fact 18). A CI run has no file and gets the keys from the job.
export function loadDotEnv(): void {
  const path = `${repoRoot}/.env`;
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    // An unreadable file is not fatal: the keys can also come from the real environment.
  }
}

function runEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

// The env of `db:migrate`, the seed and the server. Refuses a target that the seed would wipe (stage 12) before any command runs.
export function e2eEnv(): Record<string, string> {
  const appUrl = process.env.E2E_DATABASE_URL;
  const migratorUrl = process.env.E2E_MIGRATOR_DATABASE_URL;
  if (appUrl === undefined || appUrl === "" || migratorUrl === undefined || migratorUrl === "") {
    throw new Error(missingMessage);
  }
  const target = seedTargetOk(appUrl, migratorUrl);
  if (!target.ok) throw new Error(`refusing: ${target.reason}`);

  return {
    ...runEnv(),
    PORT: `${E2E_PORT}`,
    WEB_BASE_URL: E2E_BASE_URL,
    WEB_AUTH_SECRET: E2E_SECRET,
    WEB_DIST: "apps/web/dist",
    WEB_TRUSTED_ORIGINS: "",
    WEB_TRUSTED_PROXIES: "127.0.0.1",
    DATABASE_URL: appUrl,
    MIGRATOR_DATABASE_URL: migratorUrl,
    ACTIONS_SCOPE: "synthetic",
    TRIAGE_LLM_SCOPE: "off",
    SEND_SCOPE: "off",
    // Empty values keep the e2e server away from the dev bot and the heartbeat (fact 21).
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_API_ROOT: "",
    HEARTBEAT_URL: "",
    LOG_LEVEL: "info",
  };
}
