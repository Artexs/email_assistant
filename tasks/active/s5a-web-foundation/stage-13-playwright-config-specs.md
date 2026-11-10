# s5a-web-foundation — Stage 13

Part of [`../s5a-web-foundation.md`](../s5a-web-foundation.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 13 — Playwright: `playwright.config.ts`, `global-setup.ts`, the `test:e2e` script, the auth smoke in both projects (W20), the CSP assertion

The e2e run itself happens in the worktree, started by the main session (the review copies run only lint, typecheck and unit tests). **Pipeline pause:** user step 2 (the e2e database lines in the worktree's `.env`) before 13.1.

- [x] **13.1 `playwright.config.ts`, `env.ts`, `global-setup.ts`, `seed.ts`, the `test:e2e` script (D19, W10)**
  - Goal: `bun run test:e2e` starts the server on 8081 against the e2e database, seeds it, and runs the specs in the `mobile` and `desktop` projects with the system Chromium locally and Playwright's Chromium in CI; every test has its own client address, so the login rate limit never crosses tests.
  - Files: create `apps/web/e2e/playwright.config.ts`, `apps/web/e2e/global-setup.ts`, `apps/web/e2e/env.ts`, `apps/web/e2e/seed.ts`; change `apps/web/package.json` (`"@playwright/test": "1.65.0"` in `devDependencies`, exact), the root `bun.lock`, the root `package.json` (`"test:e2e": "bunx playwright test -c apps/web/e2e/playwright.config.ts"`).
  - Interfaces:

    ```ts
    // env.ts — the one place that knows the e2e environment
    export const E2E_PORT = 8081;
    export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
    export const E2E_SECRET = "e2e-web-auth-secret-0123456789abcdefghij"; // 40 characters, a test value
    export const repoRoot: string; // resolve(import.meta.dirname, "../../..")
    export function loadDotEnv(): void; // try { process.loadEnvFile(`${repoRoot}/.env`) } catch {} — only when the file exists (fact 18)
    export function e2eEnv(): Record<string, string>; // requires E2E_DATABASE_URL and E2E_MIGRATOR_DATABASE_URL (else it throws `set E2E_DATABASE_URL and E2E_MIGRATOR_DATABASE_URL: run bun run db:worktree e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env`); returns the string entries of process.env plus { PORT: "8081", WEB_BASE_URL: E2E_BASE_URL, WEB_AUTH_SECRET: E2E_SECRET, WEB_DIST: "apps/web/dist", WEB_TRUSTED_ORIGINS: "", WEB_TRUSTED_PROXIES: "127.0.0.1", DATABASE_URL: E2E_DATABASE_URL, MIGRATOR_DATABASE_URL: E2E_MIGRATOR_DATABASE_URL, ACTIONS_SCOPE: "synthetic", TRIAGE_LLM_SCOPE: "off", SEND_SCOPE: "off", TELEGRAM_BOT_TOKEN: "", TELEGRAM_API_ROOT: "", HEARTBEAT_URL: "", LOG_LEVEL: "info" }
    // e2eEnv() also calls seedTargetOk(E2E_DATABASE_URL, E2E_MIGRATOR_DATABASE_URL) (stage 12, a pure value import) and throws `refusing: <reason>`
    // when it fails, so db:migrate never runs on another database (second cold review, finding 3)
    // seed.ts
    import type { SeedFile } from "../../server/src/scripts/e2e-seed-args"; // seed.ts imports the type, env.ts imports seedTargetOk: the two cross-package relative imports, inside the test tooling (e2e-seed-args.ts stays pure)
    export function readSeed(): SeedFile; // JSON.parse of apps/web/e2e/.seed.json
    // global-setup.ts (default export)
    // const env = e2eEnv(); execFileSync("bun", ["run", "db:migrate"], { cwd: repoRoot, env, stdio: "inherit" }); execFileSync("bun", ["apps/server/src/scripts/e2e-seed.ts"], { cwd: repoRoot, env, stdio: "inherit" })
    ```

    `playwright.config.ts`: `loadDotEnv()`; `const env = e2eEnv()`; `defineConfig({ testDir: "./tests", globalSetup: "./global-setup.ts", timeout: 30_000, expect: { timeout: 5_000 }, retries: 0, workers: 1, reporter: process.env.CI ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "line", outputDir: "test-results", use: { baseURL: E2E_BASE_URL, trace: "retain-on-failure", launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {} }, projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }, { name: "desktop", use: { viewport: { width: 1280, height: 800 } } }], webServer: { command: "bun apps/server/src/main.ts", cwd: repoRoot, url: E2E_BASE_URL + "/health", reuseExistingServer: false, timeout: 60_000, env, stdout: "pipe", stderr: "pipe" } })`.

  - Decisions:
    - `WEB_TRUSTED_PROXIES: "127.0.0.1"` and a per-test `x-forwarded-for` (13.2) give every test its own client address, so Better Auth's `/sign-in/email` rule (3 per 10 s per address, fact 8) counts per test, and W1 runs end to end (cold review of this plan, finding 3).
    - Bun keeps an empty environment value and does not refill it from `.env` (fact 21), so `TELEGRAM_BOT_TOKEN: ""` keeps the e2e server away from the dev bot and `HEARTBEAT_URL: ""` from the heartbeat; `LOG_LEVEL: "info"` so that the server's `telegram is off (TELEGRAM_BOT_TOKEN is empty)` and `web is on: …` lines are visible in the piped stdout; 13.2's first test asserts them indirectly through the behaviour (a login works) and the implementer checks the `webServer` output once by eye (`stdout: "pipe"` shows it on a failure).
    - `workers: 1`: the seed is one fixed organization and the specs change its state; the two projects run one after the other, each with its own assistant and setup link (stage 12).
    - Playwright starts the `webServer` and runs `globalSetup`; the server does not need the seed at start (it reads at request time), so the order between them does not matter. `db:migrate` on the e2e database keeps it current when a later segment adds a migration.
    - `CHROMIUM_PATH=/usr/bin/chromium` in the developer's `.env` (user step 2) → the system browser; unset → Playwright's own Chromium (`bunx playwright install chromium` once locally, `--with-deps` in CI).
    - `apps/web/tsconfig.json` includes `e2e/**` (it includes `**/*`); `astro check` must pass over these files (`@playwright/test` types resolve from the web package's `node_modules` or the hoisted root).
  - Test: `bunx playwright test -c apps/web/e2e/playwright.config.ts --list` lists the specs of 13.2 (write 13.1 and 13.2 together; the `--list` check is the first run of the config); `bun run typecheck` passes over `apps/web/e2e`.
  - Check: `bun run lint && bun run typecheck`, then 13.2's run.
  - Done when: `--list` works and `typecheck` passes.
  - Out of scope: CI (stage 14).

- [x] **13.2 `tests/auth.spec.ts` (W20) and `helpers.ts`**
  - Goal: the S5a done-when has its Playwright proof in both projects: wrong password, login and the shell, sign-out and the gate, the setup link once, zero CSP errors with the overlays open, no banner, the login rate limit.
  - Files: create `apps/web/e2e/tests/auth.spec.ts`, `apps/web/e2e/helpers.ts` (`cspErrors(page)`: collects console messages whose text contains `Content Security Policy`, page errors, and every `securitypolicyviolation` event: `page.addInitScript` adds a `document` listener that logs ``console.warn(`csp-violation ${e.violatedDirective} ${e.blockedURI}`)``, and the helper collects the lines that start with `csp-violation` (fact 23: Chromium logs no console text for an eval violation); `signIn(page, email, password)`; `nextAddress()`: a per-test `x-forwarded-for` value `198.51.100.<n>` from a module counter, applied with `test.use({ extraHTTPHeaders: { "x-forwarded-for": … } })` in a `beforeEach` through `browser.newContext`, or simpler: each test creates its context with `extraHTTPHeaders`).
  - Decisions: the texts come from `../../src/i18n/en` (one source, U1); locators by role and label (U9): `getByLabel(en.email_label)`, `getByLabel(en.password_label, { exact: true })`, `getByRole("button", { name: en.sign_in })`, `getByRole("alert")`, `getByRole("navigation", { name: en.nav_main })`, `getByRole("button", { name: en.menu_open })` (mobile), `getByRole("button", { name: en.user_menu })` (desktop: the sidebar's bottom block, stage 10), `getByRole("menuitem", { name: en.log_out })` (desktop) / `getByRole("button", { name: en.log_out })` (mobile, in the sheet). The project name decides mobile or desktop steps (`test.info().project.name`). Every test uses a fresh context with its own `x-forwarded-for` address (`198.51.100.<n>`), so the sign-ins of one test never count for another.
  - Test (each in both projects; `test.describe.configure({ mode: "serial" })` because test 4 consumes the project's one setup link):
    1. **Wrong password:** `/login` → fill the owner e-mail and `wrong-password-xx` → submit → `getByRole("alert")` has text `en.login_error_credentials`; the URL is still `/login`; the password field is empty, the e-mail field keeps its value.
    2. **Login and the shell:** fill the right password → submit → the URL ends with `/onboarding`; the `<h1>` is `en.title_onboarding`; the placeholder text `en.placeholder_text` is visible; mobile: the bottom `navigation` "Main" has the four links and `Activity` has no `aria-current`, the menu button opens a dialog with `en.nav_onboarding` and the owner e-mail; desktop: the sidebar lists `en.nav_onboarding` first, the user menu button at its bottom shows the e-mail and opens with `en.log_out`. The banner `getByRole("status")` is not present (0 mailboxes, W20 case 6).
    3. **Sign-out and the gate:** click `en.log_out` (from the sheet on mobile, the user menu on desktop) → the URL is `/login`; `page.goto("/activity")` → the URL is `/login?next=%2Factivity`; `page.request.get("/api/me")` → status 401.
    4. **Setup link once:** `const assistant = seed.assistants[project]`; `page.goto(assistant.setupUrl)` → the URL matches `/setup?token=`; fill the assistant e-mail, a 3-character password → `#password-error` has the text `en.password_too_short` (read errors by their id: that text is also a substring of `en.password_help`, so `getByText` would match two elements); fill `a-good-passphrase-for-e2e` and a different repeat → `#repeat-error` has `en.passwords_differ`; fill both the same → submit → the URL ends with `/onboarding` (signed in as the assistant: the e-mail in the shell is the assistant's); `page.goto(assistant.setupUrl)` again → the alert `en.setup_link_invalid` and the link `en.go_to_sign_in`; `page.goto("/setup")` (no token) → `en.setup_link_missing`.
    5. **CSP:** with `cspErrors(page)` attached before `goto`, `/login` and `/onboarding` (signed in as the owner) plus opening the menu sheet (mobile) or the user menu (desktop) → the collected list is empty; `page.goto("/nope")` → the response status is 404 and the page shows `en.not_found_title`.
    6. **Rate limit (W20 case 7):** in a fresh context with its own address, four wrong sign-ins in a row → the fourth alert is `en.error_too_many` (429); a new context with another address signs in at once with the right password.
  - Check: `bun run web:build && bun run test:e2e` → `12 passed` (6 tests × 2 projects); `bun run lint && bun run typecheck`. Run it twice in a row: the second run passes too (the seed resets the organization; the consumed setup links are re-made).
  - Done when: both runs pass locally (`CHROMIUM_PATH` set, or Playwright's Chromium installed), and the worktree and dev databases show no `E2E` organization (`SELECT count(*) FROM organizations WHERE name = 'E2E'` → 0 on both); the not-verified items "the `better-auth/react` client's error shape" and "the e2e environment" are marked verified in the segment file.
  - Out of scope: the CI job (stage 14), S5b–S5d smoke tests.
