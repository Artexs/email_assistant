# F136 stage 01 — Ports from env, both suites

Needs: nothing new; it reads `apps/web/e2e/env.ts`, `servers.ts` and `apps/docs/e2e/site.ts` at HEAD. May run next to 02 (no shared file).

Part of [`../plan.md`](../plan.md). Decisions D1, D3, D7, D8.

## Step 1 — One port module for the job env contract

**Goal.** One pure place parses the port keys, so both suites, prepare (stage 03) and the tests share one rule.

**Files.** New `apps/server/src/scripts/e2e-job-env-args.ts` and its unit test. The docs suite already imports from `apps/server/src` (`serve.ts`), and the web suite does the same (`e2e-seed-args.ts`), so this module serves both.

**Interfaces (later stages use these names).**
- `E2E_DEFAULT_PORTS = { app: 8081, telegram: 8092, docs: 8093 } as const`.
- `portFromEnv(value: string | undefined, key: string, fallback: number): number`. Unset or `""` → fallback. Anything else must be a decimal integer 1024–65535, or it throws an `Error` whose message holds `key`.
- `e2ePorts(env: Record<string, string | undefined>): { app: number; telegram: number }`. Reads `E2E_PORT` and `E2E_TELEGRAM_PORT`. Throws when the two are equal.
- `docsTestPort(env): number`. Reads `DOCS_TEST_PORT`.
- `loadRepoDotEnv(repoRoot: string): void`. Loads `<repoRoot>/.env` with `process.loadEnvFile` when the file exists and ignores a read error, like `loadDotEnv` today. It never overrides a set key (fact F2).

**Test (new file).**
1. `portFromEnv(undefined, "E2E_PORT", 8081)` → 8081, and `portFromEnv("", …)` → 8081.
2. `portFromEnv("28560", …)` → 28560.
3. `"80"`, `"70000"`, `"abc"`, `"285 60"` and `"28560.5"` each throw a message that holds `E2E_PORT`.
4. `e2ePorts({})` → `{ app: 8081, telegram: 8092 }`.
5. `e2ePorts({ E2E_PORT: "28560", E2E_TELEGRAM_PORT: "28561" })` → `{ app: 28560, telegram: 28561 }`.
6. `e2ePorts({ E2E_PORT: "28560", E2E_TELEGRAM_PORT: "28560" })` throws.
7. `docsTestPort({})` → 8093, and `docsTestPort({ DOCS_TEST_PORT: "28562" })` → 28562.
8. `loadRepoDotEnv` on a temp folder whose `.env` holds `F136_PROBE=file`: with `process.env.F136_PROBE = "process"` set first, the value stays `process`; with the key unset, it becomes `file`. Clean up the key after the test.

## Step 2 — Both suites read the ports

**Goal.** The panel suite, the docs-shot run and the docs suite use the port of this run.

**Decisions.**
- `env.ts` calls `loadRepoDotEnv(repoRoot)` at module top, before it computes `E2E_PORT` and `E2E_TELEGRAM_PORT` from `e2ePorts(process.env)`. The exported names keep their meaning (D7). `loadDotEnv()` stays as a thin wrapper, or goes if no caller is left; the worker decides.
- `site.ts` does the same for `DOCS_TEST_PORT` through `docsTestPort(process.env)`, and exports `docsLocalOrigin(env): string`. The docs Playwright config calls `docsLocalOrigin(process.env)` in its own body, so each evaluation reads the env of that moment. Bun caches `site.ts` across cache-busted config imports (review B1). The config itself does not load `.env`. `serve.ts` reads `docsTestPort(process.env)`.
- `servers.ts` keeps the exact text `--port ${E2E_TELEGRAM_PORT}`.
- `.env.example` gets the three keys, empty, with one comment line: "per job from scripts/limen-prepare.sh; empty = 8081, 8092, 8093". If a test checks `.env.example` against the config schema, add the keys to its list of non-server keys, next to `E2E_DATABASE_URL`.
- Update the two assertions of `apps/docs/scripts/browser-check.test.ts` (D8): the port case checks `docsTestPort({})` = 8093, and the config case sets `process.env.DOCS_TEST_PORT = "28562"`, imports the config with a cache-buster, then deletes the key and imports again, expecting `http://127.0.0.1:28562/email_assistant/` and `http://127.0.0.1:8093/email_assistant/`. Restore the old value in `finally`, as the case does for `DOCS_TEST_URL`. The case count stays the same.

**Test.**
9. The browser-check config case above, both ports.
10. Manual, under the lock: `E2E_PORT=28560 E2E_TELEGRAM_PORT=28561 bun run test:e2e` passes on this stage's own e2e DB (plan § Rules).
11. Manual, under the lock: `DOCS_TEST_PORT=28562 bun run docs:test` passes after `bun run docs:build`.
12. Manual: `E2E_PORT=80 bun run test:e2e` exits non-zero before any server starts, and the output names `E2E_PORT`.

**Out of scope.** Prepare and the slot picker (stages 03–04), mail addresses (stage 02), rule texts (stage 06).

## Done when

Tests 1–12 pass. Proof links after `test:int:ci`: `bun run web:build > /tmp/f136-s01/web.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env E2E_PORT=28560 E2E_TELEGRAM_PORT=28561 bun run test:e2e > /tmp/f136-s01/e2e.log 2>&1 && bun run docs:build > /tmp/f136-s01/docs.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env DOCS_TEST_PORT=28562 bun run docs:test > /tmp/f136-s01/site.log 2>&1`.
