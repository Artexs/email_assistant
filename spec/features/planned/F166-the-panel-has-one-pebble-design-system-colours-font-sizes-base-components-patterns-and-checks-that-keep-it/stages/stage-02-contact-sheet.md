# F166 stage 02 — The contact sheet and the scan schemes

Part of [`../plan.md`](../plan.md). Needs: nothing. May run next to 01.

## Step 1 — Route table

- **Goal:** one typed list of everything the sheet shoots.
- **Files:** `apps/web/e2e/ui-sheet/routes.ts`, its test in `apps/web/e2e/lib/` (that folder is in `test:unit`).
- **Interface:** `SHEET_ROUTES: { name: string; path: string; state: SheetState; ready: TextKey | null }[]`. `state` names who signs in: `public` (no session), or a seeded organization of the e2e seed (`apps/web/e2e/seed.ts`): the main owner (no flag, no mailbox) and each flag organization the seed has (approvals, review, stats, delegations, open loops and the others you find). `ready` is the heading key the shot waits for.
- **Decisions:** D7. A page that looks different with a flag gets one row per state. Include: every file of `apps/web/src/pages/` (the legal pages in both languages, 404, offline), an approval detail (`/approvals?id=` of a seeded draft) and one open dialog per page where the seed allows it with no write. `/operator` goes to `SHEET_SKIP` with the reason "the e2e server has no operator user".
- **Test:** (1) every `.astro` file under `src/pages` maps to at least one row or to an entry of `SHEET_SKIP` with a reason; a fake file list with `pages/new.astro` gives the problem `no sheet row: /new`. (2) Row names are unique.

## Step 2 — The run

- **Goal:** `bun run ui:sheet` writes the pictures and the index.
- **Files:** `apps/web/e2e/ui-sheet.config.ts` (reuse `e2eWebServers` and the global setup, like `docs-shots.config.ts`), `apps/web/e2e/ui-sheet/sheet.spec.ts`, root `package.json` script `ui:sheet`.
- **Behaviour:** for each row × viewport (Pixel 7; 1280 × 800) × scheme (`colorScheme` light, dark) × locale (`en`, `pl`; set `localStorage` key `ea.locale` as `docs-shots/shots.spec.ts` does): open, wait for `ready` and for no `[aria-busy="true"]`, shoot the full page with `animations: "disabled"` to `<dir>/<state>/<name>-<phone|desktop>-<light|dark>-<en|pl>.png`. `<dir>` is `UI_SHEET_DIR`, default `~/.local/share/email-assistant/ui-sheet/<LIMEN_JOB_ID or "local">/` (D7); the run empties `<dir>` first when `UI_SHEET_ROUTES` is not set, and prints the full path of the index at the end. The Playwright `outputDir` of this config is its own folder under `test-results`. Also record `overflow: true` when `document.documentElement.scrollWidth > clientWidth` at a 320 px wide viewport. The run never fails on a look; it fails only when a page does not load. `UI_SHEET_ROUTES=a,b` limits the rows by name. One sign-in per state; a fixed documentation client address per state (see the shots spec) so the login rate limit holds.
- **Out of scope:** pixel comparison; a CI job; writes to the seed.

## Step 3 — The index

- **Goal:** one page a person scrolls.
- **Files:** `apps/web/e2e/lib/sheet-index.ts` (pure) and its test.
- **Interface:** `sheetIndexHtml(entries: { state: string; name: string; viewport: "phone" | "desktop"; scheme: "light" | "dark"; locale: "en" | "pl"; file: string; overflow: boolean }[]): string`: one section per route, the eight pictures in a fixed order, an "overflow" mark, relative file links, no script, no remote asset.
- **Test:** (3) two entries of one route give one section with two `img` tags in the order phone-light-en, desktop-light-en; (4) an entry with `overflow: true` carries the text `overflow at 320 px`; (5) a name with `<` is escaped.

## Step 4 — Scan schemes

- **Files:** `apps/web/e2e/a11y.ts`.
- **Decisions:** D9. `A11yScope` gains `schemes?: ("light" | "dark")[]`. Without it, the call uses `defaultSchemes(projectName)`, a pure function next to a constant `DARK_SCAN_ON = false`: it returns `["light"]` while the constant is false, and `["light", "dark"]` for the project `desktop` and `["light"]` for `mobile` when it is true. For each scheme the function emulates it, scans, and at the end restores the scheme the page had. A violation line starts with the scheme name.
- **Test:** (6) `defaultSchemes("desktop")` and `defaultSchemes("mobile")` give `["light"]` with the constant false; with a `true` argument for the switch they give `["light", "dark"]` and `["light"]`. (7) One existing spec called with `schemes: ["light", "dark"]` by hand reports dark violations with the prefix `dark`; write what it found in the final message, then remove the argument.

## Done when

`bun run ui:sheet` (with `bun run web:build` first) writes the index for today's look; the final message gives its full path and the count of pictures and of overflow marks. Proof A of `../plan.md` prints `PROOF_OK`.
