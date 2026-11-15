# F112 stage 11 — Screenshot component and shot run

Part of [`../plan.md`](../plan.md). Read P5, D9 and ADR 0030 point 4 ("CI makes the screenshots from a frozen demo fixture; no screenshot is added by hand"). Needs stage 06. May run next to stages 07–10 (it changes no content page).

Two steps.

## Step 1 — Shot list and `<Shot>`

- **Goal:** a page names a screenshot; the build checks it.
- **Files:** `apps/docs/src/shots.ts` (new), `apps/docs/src/components/Shot.astro` (new), a test of the list, `.gitignore` (`apps/docs/public/shots/`).
- **Interfaces:**
  - `SHOTS: readonly { name: string; path: string; locale: "en" | "pl"; viewport: "desktop" | "phone"; alt: string }[]`; `name` is `<page>-<locale>-<viewport>` and unique; `path` is a panel path (`/onboarding`, `/settings`, …).
  - `<Shot page="settings" />` on its own line (stage 04 `bodyHash` ignores such lines). It picks the shots of the page language, both viewports (desktop shown, phone as a `<picture>` source for narrow screens), from `${DOCS_BASE}/shots/<name>.png`.
  - Env `DOCS_SHOTS`: `on` → a missing file fails the build (`shot_missing <name>`); unset → the component renders a bordered box with the `alt` text and the build logs `shots: off` once. An unknown `page` fails the build in both cases.
- **Test:**
  - T1: names are unique and match the pattern; each page has en and pl for both viewports.
  - T2: `DOCS_SHOTS=on bun run docs:build` with an empty shots folder and one fixture page that uses `<Shot>` fails with `shot_missing` (a test fixture, not a real page).
  - T3: `bun run docs:build` (unset) passes and logs `shots: off`.

## Step 2 — Playwright shot run

- **Goal:** one command makes every PNG from the e2e seed.
- **Files:** `apps/web/e2e/docs-shots.config.ts` (new), `apps/web/e2e/docs-shots/shots.spec.ts` (new), root script `docs:shots`.
- **Decisions:**
  - Same web servers, seed and env as the panel e2e config (reuse its pieces; `test:e2e` must not run this spec). Sign in as the owner of the seed's main organization (`E2E_OWNER_EMAIL`, no flag row), never as an owner of the flagged spec organizations (approvals, delegates, stats, delete). Before the first shot, assert that `/api/me` `features` has no flag on (P2). Set the language through the panel's locale switch or the `ea.locale` storage key.
  - Viewports: desktop 1280×800, phone the `Pixel 7` device. Not full page. Wait until the page's island settles (no spinner).
  - Write to `apps/docs/public/shots/<name>.png`. Before each shot, run `publicContentProblems` (`@ea/core/web`, stage 02) on the page text; a problem stops the run with its rule and the shot name.
  - Pages: `onboarding`, `mailboxes`, `settings`, `rules`, `activity` (what the seed holds; an empty state is fine).
  - Local runs: under `flock /tmp/email-assistant-shared-tests.lock` (fixed e2e ports), with an own e2e DB (F101 stage 02 Step 3 method: `bun run db:worktree f112_s11_e2e`).
- **Test:**
  - T4: `docs:shots` writes exactly the `SHOTS` files (20 = 5 pages × 2 locales × 2 viewports), each larger than 10 KB.
  - T5: `DOCS_SHOTS=on bun run docs:build` passes after T4.
  - T6: `git status` shows no PNG.
- **Done when:** T1–T6 hold.
- **Out of scope:** `<Shot>` on content pages and the deploy (stage 12).

## Proof

```
mkdir -p /tmp/f112-s11 && bun run lint > /tmp/f112-s11/lint.log 2>&1 && bun run typecheck > /tmp/f112-s11/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f112-s11/unit.log 2>&1 && bun run web:build > /tmp/f112-s11/web.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run docs:shots > /tmp/f112-s11/shots.log 2>&1 && DOCS_SHOTS=on bun run docs:build > /tmp/f112-s11/docs.log 2>&1 && echo PROOF_OK
```
