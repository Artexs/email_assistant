# F112 stage 13 — Panel Help link and "What is new" card

Part of [`../plan.md`](../plan.md). Read P4, P9, D2, D12, D13 and `docs/code-patterns.md` § "Web app" and the texts rules. Needs stage 12.

Three steps.

## Step 1 — Flag and card logic

- **Goal:** the card rules of P9 as one pure function, and the flag.
- **Files:** `packages/core/src/features.ts` (flag), `apps/web/src/lib/whats-new.ts` (new) and test.
- **Interfaces:**
  - Flag `docs_links`: `{ default: false, description: "The Help link and the What is new card in the panel.", epic: "E10a", removeBy: "2027-06-01" }`.
  - `whatsNew(releases: ChangelogRelease[], stored: string | null): { show: ChangelogRelease[]; newest: string | null }`: `Unreleased` is ignored; `newest` = the highest released version or `null`; `show` follows P9, drops releases with no "For users" items, at most 5 releases.
  - Storage key `ea.whatsNewSeen` (browser `localStorage`). Dismiss writes `newest`.
- **Test** (releases as versions with one item each unless named):
  - T1: `[0.2.0, 0.1.0]`, stored `null` → show `[0.2.0]`, newest `0.2.0`.
  - T2: same, stored `0.1.0` → `[0.2.0]`.
  - T3: `[0.3.0, 0.2.0, 0.1.0]`, stored `0.1.0` → `[0.3.0, 0.2.0]`.
  - T4: stored `0.2.0` → `[]`; stored `0.9.0` → `[]` (downgrade).
  - T5: stored `garbage` → `[0.2.0]`.
  - T6: only `Unreleased` → `[]`, newest `null`.
  - T7: `[0.2.0 (no items), 0.1.0]`, stored `0.1.0` → `[]`, newest `0.2.0`.
  - T8: seven releases newer than stored → 5 shown, newest first.

## Step 2 — Panel UI

- **Goal:** with `docs_links` on, the member sees a Help link and, when P9 says so, the card.
- **Files:** the panel shell (nav or account menu, and the area under the banners), `apps/web/src/i18n/en.ts` and `pl.ts`, the page or layout that passes the releases, `deploy/Dockerfile` (copy `CHANGELOG.md` before the web build, D13).
- **Decisions:**
  - Releases are parsed at build time from `CHANGELOG.md` (`parseChangelog`); the island gets only the released versions with their "For users" lines (no raw Markdown in the bundle). A bad changelog fails `web:build`.
  - The flag comes from `/api/me` `features`, as for `stats_page`. Flag off: no link, no card, no storage read.
  - Help link: text key `help_link` ("Help" / Polish from the translator rule of `docs/code-patterns.md`), `href = docsUrl("/", locale)`, `target="_blank"`, `rel="noopener noreferrer"`.
  - Card: title key `whats_new_title`, one list item per line in the panel locale, a link `whats_new_all` to `docsUrl("/changelog/", "en")`, a close button `whats_new_dismiss` (keyboard reachable, `aria-label`). It shows once per page load; dismiss hides it and writes storage. Storage read or write throws → no card.
  - No new API, no migration, no CSP change.
- **Test:**
  - T9: the i18n tests pass with the four new keys in `en.ts` and `pl.ts`.
  - T10: a component or lib test: storage that throws → no card.
  - T11: `bun run web:build` logs `csp checked in <n> page(s)` with the page count of `master`.

## Step 3 — e2e

- **Goal:** the real panel follows P9.
- **Files:** one new spec in `apps/web/e2e/tests/`; the e2e seed only if it cannot turn the flag on for the seeded organization.
- **Test** (the built panel holds the real `CHANGELOG.md`, which has only `Unreleased` until F114 makes a release; the card itself is proven by T12 with fixture releases):
  - T12 (component test, Step 2 files): releases `[0.2.0, 0.1.0]`, empty storage → the card lists the `0.2.0` lines in the panel locale; dismiss → hidden and storage holds `0.2.0`.
  - T13 (e2e): flag off → no Help link, no card.
  - T14 (e2e): flag on → Help link `href` = `https://artexs.github.io/email_assistant/`, and `…/email_assistant/pl/` after the switch to Polish.
  - T15 (e2e): flag on, the real changelog → no card while it has no released version; with a released version, the card shows it.
- **Done when:** T1–T15 hold; e2e under the flock with an own e2e DB (F101 stage 02 Step 3 method, DB `f112_s13_e2e`).

## Proof

```
mkdir -p /tmp/f112-s13 && bun run lint > /tmp/f112-s13/lint.log 2>&1 && bun run typecheck > /tmp/f112-s13/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f112-s13/unit.log 2>&1 && bun run test:int:ci > /tmp/f112-s13/int.log 2>&1 && bun run web:build > /tmp/f112-s13/web.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f112-s13/e2e.log 2>&1 && echo PROOF_OK
```
