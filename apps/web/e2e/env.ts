import { resolve } from "node:path";

import { e2ePorts, loadRepoDotEnv } from "../../server/src/scripts/e2e-job-env-args";
import {
  E2E_AUTHSERV_ID,
  E2E_GATE_FIXTURE_DIR,
  E2E_LLM_PIN,
  E2E_SEND_TEST_ADDRESS,
  seedTargetOk,
} from "../../server/src/scripts/e2e-seed-args";
import { generateVapidKeyPair } from "../../server/src/platform/vapid-keys";
import { FAKE_TOKEN } from "../../../tools/fake-telegram/src/state";

export const repoRoot = resolve(import.meta.dirname, "../../..");

// The one place that knows the e2e environment: the port, the base URL, the fixed secret and the server env.
// The ports are those of this run: `E2E_PORT` and `E2E_TELEGRAM_PORT` (a job `.env` or the process env), else 8081 and 8092.
// The repo `.env` loads here, at import, so a config that imports this module sees it before its own body runs.
// A key that is already set wins over the file. A bad value throws before any server starts.
loadRepoDotEnv(repoRoot);
const ports = e2ePorts(process.env);
export const E2E_PORT = ports.app;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
// A test value, not a secret (WEB_AUTH_SECRET needs 32 characters).
export const E2E_SECRET = "e2e-web-auth-secret-0123456789abcdefghij";

// The fake Telegram server of the run. Default port 8092, not 8090: a developer's own fake on 8090 stays untouched.
export const E2E_TELEGRAM_PORT = ports.telegram;
export const E2E_TELEGRAM_URL = `http://127.0.0.1:${E2E_TELEGRAM_PORT}`;

// The GreenMail of `bun run dev:up` (the same host the integration tests use).
export const GREENMAIL = {
  host: process.env.TEST_IMAP_HOST ?? "127.0.0.1",
  imapPort: 3143,
  smtpPort: 3025,
} as const;

// A new throw-away VAPID pair for each run of a process: it signs nothing that leaves the machine (the push specs use a fake
// push manager, and no spec calls a push service). The server needs it so that `GET /api/me/push` answers a public key.
const e2eVapid = generateVapidKeyPair();

const missingMessage =
  "set E2E_DATABASE_URL and E2E_MIGRATOR_DATABASE_URL: run bun run db:worktree e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env";

// Kept for the Playwright configs: the load already ran at import, and a second call changes nothing (set keys win).
export function loadDotEnv(): void {
  loadRepoDotEnv(repoRoot);
}

function runEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

// The env of `db:migrate`, the seed and the server. Refuses a target that the seed would wipe before any command runs.
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
    // A pinned classifier setup and a fixture folder of gate files (not the committed ones), so the autonomy card
    // spec sees the same proof in every checkout. `e2e-gate-fixture.test.ts` ties the two.
    ...E2E_LLM_PIN,
    GATE_EVIDENCE_DIR: `${repoRoot}/${E2E_GATE_FIXTURE_DIR}`,
    ACTIONS_SCOPE: "synthetic",
    TRIAGE_LLM_SCOPE: "off",
    // Only the first delegate of the approvals organizations passes, so one approved send goes out (to the GreenMail of
    // the dev stack, through the seeded mailbox) and the others stay held by the scope. Every other organization has no approved send.
    SEND_SCOPE: "self",
    SEND_TEST_ADDRESSES: E2E_SEND_TEST_ADDRESS,
    // The newsletters spec seeds a `dkim=pass` of this authserv-id; it gives one-click.
    MAIL_TRUSTED_AUTHSERV_IDS: E2E_AUTHSERV_ID,
    MAIL_ALLOW_LOCAL_HOSTS: "true",
    // The e2e server has no internet: the leaked-password check would fail closed.
    AUTH_PWNED_CHECK: "off",
    // The fake Telegram keeps the e2e server away from the dev bot; the empty heartbeat keeps it away from the monitor (fact 21).
    TELEGRAM_BOT_TOKEN: FAKE_TOKEN,
    TELEGRAM_API_ROOT: E2E_TELEGRAM_URL,
    HEARTBEAT_URL: "",
    VAPID_PUBLIC_KEY: e2eVapid.publicKey,
    VAPID_PRIVATE_KEY: e2eVapid.privateKey,
    VAPID_SUBJECT: "mailto:e2e@e2e.test",
    LOG_LEVEL: "info",
    // Fake client keys turn the Microsoft sign-in on as "configured". A new connect also needs the flag
    // `mail_oauth_microsoft`, which only `mailbox-oauth.spec.ts` turns on. No request goes to Microsoft.
    MAIL_OAUTH_MICROSOFT_CLIENT_ID: "e2e-fake-client-id",
    MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: "e2e-fake-client-secret",
  };
}
