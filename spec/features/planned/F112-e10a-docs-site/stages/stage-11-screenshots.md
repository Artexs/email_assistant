# F112 stage 11 — Screenshots

Part of [`../plan.md`](../plan.md). Read P5, D9, D10 and ADR 0030 point 4 ("CI makes the screenshots from a frozen demo fixture; no screenshot is added by hand"). Needs stage 10 (Step 3 adds shots to the pages of stages 07, 08 and 10).

Three steps.

## Step 1 — Shot list and `<Shot>`

- **Goal:** a page names a screenshot; the build checks it.
- **Files:** `apps/docs/src/shots.ts` (new), `apps/docs/src/components/Shot.astro` (new), a test of the list, `.gitignore` (`apps/docs/public/shots/`).
- **Interfaces:**
  - `SHOTS: readonly { name: string; path: string; locale: "en" | "pl"; viewport: "desktop" | "phone"; alt: string }[]`; `name` is `<page>-<locale>-<viewport>` and unique; `path` is a panel path (`/onboarding`, `/settings`, …).
  - `<Shot page="settings" />` picks the shot for the page language and both viewports (desktop shown, phone in a `<picture>` source for narrow screens), from `${DOCS_BASE}/shots/<name>.png`.
  - Env `DOCS_SHOTS`: `on` → a missing file fails the build (`shot_missing <name>`); unset → the component renders a bordered box with the `alt` text and the build logs `shots: off` once. An unknown `page` fails the build in both cases.
- **Test:**
  - T1: names are unique and match the pattern; each page has en and pl for both viewports.
  - T2: `DOCS_SHOTS=on bun run docs:build` with an empty shots folder fails with `shot_missing`.
  - T3: `bun run docs:build` (unset) passes and logs `shots: off`.

## Step 2 — Playwright shot run

- **Goal:** one command makes every PNG from the e2e seed.
- **Files:** `apps/web/e2e/docs-shots.config.ts` (new), `apps/web/e2e/docs-shots/shots.spec.ts` (new), root script `docs:shots`.
- **Decisions:**
  - Same web servers, seed and env as the panel e2e config (reuse its pieces; do not change `test:e2e`, which must not run this spec). Sign in as the seeded owner; the language through the panel's own locale switch or `ea.locale` storage.
  - Viewports: desktop 1280×800, phone the `Pixel 7` device. Full page off; wait for the page's island to settle (no spinner).
  - Write to `apps/docs/public/shots/<name>.png`. Before a shot, check the page text with the public-content rules R1–R3 of stage 02 (shared function): a seed value that fails stops the run.
  - Pages: `onboarding`, `mailboxes`, `settings`, `rules`, `activity` (with what the seed holds; an empty state is fine).
  - Runs under `flock /tmp/email-assistant-shared-tests.lock` (fixed e2e ports), with an own e2e DB (F101 stage 02 Step 3 method: `bun run db:worktree f112_s11_e2e`).
- **Test:**
  - T4: `docs:shots` writes exactly the `SHOTS` files (20 = 5 pages × 2 locales × 2 viewports), each larger than 10 KB.
  - T5: `DOCS_SHOTS=on bun run docs:build` passes after T4.

## Step 3 — Pages and deploy

- **Goal:** the tutorial and how-to pages show the shots; the deploy makes them.
- **Files:** the `.mdx` pages of stages 07, 08, 10 (add `<Shot>` where a step shows a panel page; at most one per section), `.github/workflows/docs-deploy.yml`.
- **Decisions:** in the deploy `build` job, before `docs:build`: the services and setup of the `e2e` job (Postgres, GreenMail, roles, e2e DB, migrate, `web:build`, Playwright Chromium, a random `CREDENTIALS_KEY`), then `bun run docs:shots`, then `DOCS_SHOTS=on bun run docs:build`. The PNGs go into the Pages artifact, never into git. The CI `docs` job stays without shots.
- **Test:**
  - T6: the deploy YAML parses; its `build` job has the services `postgres` and `greenmail` and runs `docs:shots` before `docs:build`.
  - T7: `bun run docs:build` passes; `git status` shows no PNG.
- **Done when:** T1–T7 hold.

## Proof

```
mkdir -p /tmp/f112-s11 && bun run lint > /tmp/f112-s11/lint.log 2>&1 && bun run typecheck > /tmp/f112-s11/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f112-s11/unit.log 2>&1 && bun run web:build > /tmp/f112-s11/web.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run docs:shots > /tmp/f112-s11/shots.log 2>&1 && DOCS_SHOTS=on bun run docs:build > /tmp/f112-s11/docs.log 2>&1 && echo PROOF_OK
```
