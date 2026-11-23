# F166 stage 04 — The pattern page and primitives A

Part of [`../plan.md`](../plan.md). Needs: stage 03 (tokens).

## Step 1 — The pattern page

- **Goal:** one page that shows every primitive and pattern; not in a production build.
- **Files:** `apps/web/src/dev/patterns.astro`, `apps/web/src/dev/PatternsPage.tsx`, `apps/web/src/dev/sections/` (one file per primitive or pattern, exported through `sections/index.ts`), `apps/web/integrations/dev-pages.ts` and its test, `apps/web/astro.config.mjs`, the e2e and dev start (set `EA_DEV_PAGES=1` where the e2e build and `web:dev` run), `apps/web/e2e/ui-sheet/routes.ts` (a `public` row `patterns`).
- **Decisions:** D8. Check `injectRoute` first; the fallback is in `../plan.md` § Not verified. The page needs no session and calls no API. Demo texts are English literals (keep `src/dev/` out of the literal-text lint scope; do not add it to `islands.test.ts`).
- **Interface:** `devPages(env: Record<string, string | undefined>): AstroIntegration`; route `/dev/patterns`.
- **Test:** (1) `devPages({ EA_DEV_PAGES: "1" })` injects one route with pattern `/dev/patterns`; `devPages({})` injects none. (2) After a build with no `EA_DEV_PAGES`, `apps/web/dist/dev` does not exist. (3) The Dockerfile sets no `EA_DEV_PAGES`.

## Step 2 — Button, Card, Badge

- **Files:** `components/ui/button.tsx`, `card.tsx`, `badge.tsx`; a section file for each.
- **Decisions:** D5; `../interfaces.md` § Primitives. The primary button has the soft coloured shadow of the mockup (`.btn.primary`). Every interactive size keeps a visible focus ring. `Card` gets a border under `forced-colors: active` (DB-7).
- **Test:** (4) existing component tests pass with no edit. (5) The section shows each variant × size; the default button is 48 px high and `xs` is 36 px in the desktop shot (measure with `boundingBox` in a small spec next to the sheet, or read the computed style).

## Step 3 — Input, Textarea, Select, Switch, Label

- **Files:** `components/ui/input.tsx`, `textarea.tsx`, `select.tsx`, `switch.tsx`, `label.tsx`; section files.
- **Decisions:** fields are 48 px, 16 px text (no zoom on focus in iOS), 2 px edge in `--input`, radius `md`; the invalid state keeps `aria-invalid` styling with the destructive tokens; the switch is 52 × 30 px with a track in `--input` when off and `--primary` when on. A compact field size that a file already uses (`h-7`, `h-8`) becomes 36 px; list those call sites in the final message for the page tickets.
- **Test:** (6) the a11y scan of the pattern page passes in both schemes (add one spec `apps/web/e2e/tests/patterns.spec.ts` that opens `/dev/patterns` and calls `expectNoA11yViolations`).

## Out of scope

Tabs, dialogs, menus, tables, alerts, toasts (stage 05). Patterns (stage 06). Any feature component: if a page breaks because of a size change (an overlap, a cut text), record it for its page ticket and fix it only when an e2e spec fails.

## Done when

`UI_SHEET_ROUTES=patterns bun run ui:sheet` shows the sections; you opened the phone and desktop pictures in both schemes next to the mockup shots `approvals-*` and `settings-*`; the Proof of `../plan.md` (stages 03–06) prints `PROOF_OK`.
