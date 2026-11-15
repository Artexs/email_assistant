# F112 stage 06 — Browser check

Part of [`../plan.md`](../plan.md). Read D1 (lockfile rule), D11, facts F4, N2, N4. Needs stage 05. Start only while no other job changes `bun.lock`.

Two steps.

## Step 1 — Playwright on the built site

- **Goal:** a real browser shows each page with no CSP violation, a working search and no accessibility error.
- **Files:** `apps/docs/e2e/` (new: `playwright.config.ts`, `serve.ts`, `site.spec.ts`), `apps/docs/package.json` (dev dependencies `@playwright/test` at the version that `apps/web` pins, and `@axe-core/playwright` exact), `bun.lock`, root script `docs:test`.
- **Decisions:**
  - `serve.ts`: a Bun static server for `apps/docs/dist` under `DOCS_BASE` on `127.0.0.1:8093` (fixed; next to the panel e2e ports 8081 and 8092). It serves `<path>/index.html` for a path that ends in `/`, and `404.html` with status 404 otherwise.
  - `docs:test` = `bunx playwright test -c apps/docs/e2e/playwright.config.ts`; the build must exist first (the spec fails with a clear message when `dist/index.html` is missing). One project, desktop Chromium 1280×800; `CHROMIUM_PATH` as in the panel e2e config.
  - The page list comes from the built `.html` files, not from a hand list.
  - Env `DOCS_TEST_URL` (stage 16): when set, the tests open that site instead of starting `serve.ts`; the page list still comes from the local `dist` (build the same commit first).
  - The violation listener uses `addInitScript` with the `securitypolicyviolation` event (F4 check script) plus console errors that contain `Content Security Policy`.
  - axe: tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. A violation in Starlight's own markup that this repo cannot fix by config or CSS is a question with the rule id; do not disable a rule without an answer (N4).
  - Local runs: always under `flock /tmp/email-assistant-shared-tests.lock` (fixed port).
- **Test:**
  - T1: every built page: 0 CSP violations, 0 page errors.
  - T2: `/email_assistant/` → open search, type `install`, at least one result within 5 s (the operator page from stage 03 holds the word).
  - T3: `/email_assistant/pl/` has `<html lang="pl">`; `/email_assistant/` has `lang="en"`.
  - T4: axe on every built page: 0 violations.
  - T5: `/email_assistant/nope/` answers 404 and shows the Starlight 404 page with 0 CSP violations.
- **Done when:** T1–T5 pass.
- **Out of scope:** Firefox and Safari (N2 stays open; say so); the panel e2e.

## Step 2 — CI

- **Goal:** CI runs the browser check on every push.
- **Files:** `.github/workflows/ci.yml` (job `docs`).
- **Decisions:** after `docs:build`: `bunx playwright install --with-deps chromium`, then `bun run docs:test`; on failure upload `apps/docs/e2e/test-results/` (7 days), as the `e2e` job does. `.gitignore` gets the docs test output folders.
- **Test:**
  - T6: the `docs` job steps parse in the YAML (the T1 command of stage 05 still prints `ci e2e image docs`).
- **Test:** T7: the server image still builds and holds no `apps/docs` source (stage 01 T11; Docker if available, else the CI `image` job). The Playwright and axe trees may enter the image as dev dependencies (`deploy/Dockerfile` keeps them): say the image size change.
- **Done when:** T6, T7 hold.

## Proof

```
mkdir -p /tmp/f112-s06 && bun install --frozen-lockfile > /tmp/f112-s06/install.log 2>&1 && bun run lint > /tmp/f112-s06/lint.log 2>&1 && bun run typecheck > /tmp/f112-s06/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f112-s06/unit.log 2>&1 && bun run docs:build > /tmp/f112-s06/docs.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run docs:test > /tmp/f112-s06/docs-test.log 2>&1 && echo PROOF_OK
```
