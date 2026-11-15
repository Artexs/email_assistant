# F112 stage 15 — Panel Help link and "What is new" card

Part of [`../plan.md`](../plan.md). Read P4, P9, D2, D12, D13, stage 14 and `docs/code-patterns.md` § "Web app" and the texts rules. Needs stage 14.

Two steps.

## Step 1 — Panel UI

- **Goal:** with `docs_links` on, the member sees a Help link and, when P9 says so, the card.
- **Files:** the panel shell (nav or account menu, and the area under the banners), `apps/web/src/i18n/en.ts` and `pl.ts`, the page or layout that passes the releases, `deploy/Dockerfile` (copy `CHANGELOG.md` before the web build, D13).
- **Decisions:**
  - Releases are parsed at build time from `CHANGELOG.md` (`parseChangelog`); the island gets only the released versions with their "For users" lines (no raw Markdown in the bundle). A bad changelog fails `web:build`. No env or file switch for another changelog (a test input in a production build is a risk).
  - The flag comes from `/api/me` `features`, as for `stats_page`. Flag off: no link, no card, no storage read.
  - Help link: text key `help_link` (Polish text by the translator rule of `docs/code-patterns.md`), `href = docsUrl("/", locale)`, `target="_blank"`, `rel="noopener noreferrer"`.
  - Card: title key `whats_new_title`, one list item per line in the panel locale, a link `whats_new_all` ("All changes for users"; the page holds only "For users" items, stage 13) to `docsUrl("/changelog/", "en")`, a close button `whats_new_dismiss` (keyboard reachable, `aria-label`). It uses stage 14 `whatsNew`, `readSeen`, `writeSeen` with the `/api/me` user id. It shows once per page load; dismiss hides it and writes storage; `"unavailable"` → no card.
  - No new API, no migration, no CSP change.
- **Test:**
  - T1: the i18n tests pass with the four new keys in `en.ts` and `pl.ts`.
  - T2 (component test with fixture releases `[0.2.0, 0.1.0]`): empty storage → the card lists the `0.2.0` lines in the panel locale; dismiss → hidden, storage key `ea.whatsNewSeen:<user id>` holds `0.2.0`; a storage that throws → no card.
  - T3: `bun run web:build` logs `csp checked in <n> page(s)` with the page count of `master`.
  - T4: the server image builds (Docker if available, else the CI `image` job) and holds `/app/CHANGELOG.md`.

## Step 2 — e2e

- **Goal:** the real panel shows the link and follows the flag.
- **Files:** one new spec in `apps/web/e2e/tests/`. It turns `docs_links` on and off for the main organization with `org-flag.ts` in `beforeAll` / `afterAll`, as `mailbox-oauth.spec.ts` does. Never in the e2e seed (stage 11 needs the main organization with no flag on).
- **Test** (the built panel holds the real `CHANGELOG.md`; at refresh 1 its only release `0.1.0` has no "For users" lines; T2 proves the card):
  - T5: flag off → no Help link, no card.
  - T6: flag on → Help link `href` = `https://artexs.github.io/email_assistant/`, and `…/email_assistant/pl/` after the switch to Polish.
  - T7: flag on, empty storage → the card state equals `whatsNew(<real changelog>, null)`: no card when `show` is empty (true for `0.1.0`), else the card with the `show` lines. The test computes it, so a later release with "For users" lines does not break it.
- **Done when:** T1–T7 hold; e2e under the flock with an own e2e DB (F101 stage 02 Step 3 method, DB `f112_s15_e2e`).

## Proof

```
mkdir -p /tmp/f112-s15 && bun run lint > /tmp/f112-s15/lint.log 2>&1 && bun run typecheck > /tmp/f112-s15/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f112-s15/unit.log 2>&1 && bun run test:int:ci > /tmp/f112-s15/int.log 2>&1 && bun run web:build > /tmp/f112-s15/web.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f112-s15/e2e.log 2>&1 && echo PROOF_OK
```
