# F166 stage 08 — The pattern page

Part of [`../plan.md`](../plan.md). Needs: stage 02 (`apps/web/e2e/ui-sheet/routes.ts`). May run next to 03. It needs no token and no mockup: it shows what exists.

## Step 1 — The route

- **Goal:** one page that shows every primitive and pattern; not in a production build (D8).
- **Files:** `apps/web/src/dev/patterns.astro`, `apps/web/src/dev/PatternsPage.tsx`, `apps/web/integrations/dev-pages.ts` and its test, `apps/web/astro.config.mjs`, the places that start the e2e build and `web:dev` (set `EA_DEV_PAGES=1` there), `apps/web/e2e/ui-sheet/routes.ts` (a `public` row `patterns`).
- **Decisions:** check `injectRoute` first; the fallback is in `../plan.md` § Not verified. The page needs no session and calls no API. Demo texts are English literals: keep `src/dev/` out of the literal-text lint scope and out of `islands.test.ts`.
- **Interface:** `devPages(env: Record<string, string | undefined>): AstroIntegration`; route `/dev/patterns`.
- **Test:** (1) `devPages({ EA_DEV_PAGES: "1" })` injects one route with the pattern `/dev/patterns`; `devPages({})` injects none. (2) After a build with no `EA_DEV_PAGES`, `apps/web/dist/dev` does not exist. (3) `deploy/Dockerfile` sets no `EA_DEV_PAGES` (a unit test reads the file).

## Step 2 — Sections that find themselves

- **Goal:** stages that run next to each other add sections with no shared file (D12).
- **Files:** `PatternsPage.tsx`, `apps/web/src/dev/sections/`.
- **Interface:** each section file has `export const section = { title: string; order: number; render: () => ReactNode }`. The page loads `import.meta.glob("./sections/*.tsx", { eager: true })`, sorts by `order` then `title`, and renders each under an `h2` with an `id` from the file name. There is no list of sections anywhere.
- **Do:** add two sections for what exists today: `tokens` (a swatch per colour token with its class name, the type scale, the radius scale) and `buttons-today` (the current `Button` variants; stage 04 replaces this file with its own).
- **Test:** (4) a pure helper `orderSections(modules)` sorts `[{order: 2, title: "b"}, {order: 1, title: "z"}, {order: 2, title: "a"}]` to `z, a, b`. (5) A module with no `section` export gives the error `no section export: <file>`.

## Step 3 — One generic spec

- **Goal:** later stages never edit the spec.
- **Files:** `apps/web/e2e/tests/patterns.spec.ts`.
- **Behaviour:** open `/dev/patterns`; call `expectNoA11yViolations` on the page; at a 320 px wide viewport assert `scrollWidth <= clientWidth` on `html`; for each `[data-open-demo]` button, in page order: click it, wait for a `[role=dialog]` or `[role=menu]`, scan it with `expectNoA11yViolations({ include })`, press Escape and wait until it is gone. One more test with `reducedMotion: "reduce"`: after each open, `document.getAnimations().length` is 0.
- **Test:** (6) the spec passes on both projects with the two sections of step 2. (7) Break check: give one swatch label the class `text-muted` on `bg-muted`; the spec fails with `color-contrast`; restore.

## Out of scope

Any change of a primitive, a token or a pattern. A link to the page from the panel.

## Done when

`UI_SHEET_ROUTES=patterns bun run ui:sheet` writes the pictures of the page; Proof C of `../plan.md` prints `PROOF_OK`.
