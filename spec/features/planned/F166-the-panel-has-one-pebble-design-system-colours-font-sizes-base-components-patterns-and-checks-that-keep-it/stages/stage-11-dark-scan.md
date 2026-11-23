# F166 stage 11 — The dark scan for every page

Part of [`../plan.md`](../plan.md). Needs: stage 04 and stage 05 (the restyled primitives; before them a dark violation would be fixed twice). It is the only stage of wave 4. The page tickets do not wait for it.

## Step 1 — Switch on

- **Files:** `apps/web/e2e/a11y.ts`: `DARK_SCAN_ON = true`.
- **Decisions:** D9. From now on every `expectNoA11yViolations` call scans light and dark on the `desktop` project and light on `mobile`.

## Step 2 — Fix what it finds

- **Do:** run the e2e suite on the `desktop` project and collect the lines that start with `dark`.
- **Decisions:** D2, D5. A violation is fixed by a token class on the element: a class change in a primitive, a pattern or a feature file is allowed; a new colour, a new token or a changed token value is not. A `dark:` class with a palette colour or an opacity trick that made the old look pass is removed, not adjusted. Never add an `exclude` to a scan to pass.
- **The bar:** more than 20 distinct violations (rule id and component) is not a fix list for one job: fix none, write the list to `dark-violations.md` in the ticket folder, and finish. A violation that no listed token can fix is a question with the element and the two colours.
- **Page tickets in flight:** a page stage that merges `master` after this stage gets the dark scan for its own specs and fixes its own page. This stage fixes what is on `master` at its base.

## Step 3 — Time

- **Do:** record the wall time of `bun run test:e2e` before the switch (from the last CI run, `gh run view`) and after it (your Proof run and, after the land, the CI `e2e` job).
- **Decisions:** `../plan.md` § Not verified: over 17 minutes for the CI job is a question to the coordinator, with the numbers. Do not change a timeout, the worker count or the retry setting.

## Test

1. `defaultSchemes("desktop")` gives `["light", "dark"]`, `defaultSchemes("mobile")` gives `["light"]` (update the unit test of stage 02 to the new constant).
2. The full e2e suite passes on both projects.
3. Break check: give one text on a page the class `text-muted` on a `bg-muted` parent; its spec fails on `desktop` with a line that starts with `dark` or `light` and `color-contrast`; restore.
4. `bun run ui:sheet` for each page you changed: open the dark pictures, phone and desktop.

## Out of scope

Light-scheme changes. Layout. The `mobile` project's dark scan.

## Done when

The final message lists each violation fixed (rule, file, the class change) and the two times; Proof B of `../plan.md` prints `PROOF_OK`.
