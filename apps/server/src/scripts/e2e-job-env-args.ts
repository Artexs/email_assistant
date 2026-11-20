import { existsSync } from "node:fs";

// The port contract of the Playwright suites. One pure place parses the keys, so the panel suite, the docs suite,
// the job prepare script and their tests share one rule. Unset or empty keeps the fixed port of a main checkout and CI.
export const E2E_DEFAULT_PORTS = { app: 8081, telegram: 8092, docs: 8093 } as const;

const PORT_MIN = 1024;
const PORT_MAX = 65535;

export function portFromEnv(value: string | undefined, key: string, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(`${key} must be an integer from ${PORT_MIN} to ${PORT_MAX}`);
  }
  return port;
}

// The two ports of the panel suite: the web server and the fake Telegram. They must differ.
export function e2ePorts(env: Record<string, string | undefined>): { app: number; telegram: number } {
  const app = portFromEnv(env.E2E_PORT, "E2E_PORT", E2E_DEFAULT_PORTS.app);
  const telegram = portFromEnv(env.E2E_TELEGRAM_PORT, "E2E_TELEGRAM_PORT", E2E_DEFAULT_PORTS.telegram);
  if (app === telegram) throw new Error(`E2E_PORT and E2E_TELEGRAM_PORT must differ (both are ${app})`);
  return { app, telegram };
}

export function docsTestPort(env: Record<string, string | undefined>): number {
  return portFromEnv(env.DOCS_TEST_PORT, "DOCS_TEST_PORT", E2E_DEFAULT_PORTS.docs);
}

// Playwright runs on Node, which loads no `.env` by itself. A key that is already set keeps its value (`process.loadEnvFile`).
// A CI run has no file and gets the keys from the job.
export function loadRepoDotEnv(repoRoot: string): void {
  const path = `${repoRoot}/.env`;
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    // An unreadable file is not fatal: the keys can also come from the real environment.
  }
}
