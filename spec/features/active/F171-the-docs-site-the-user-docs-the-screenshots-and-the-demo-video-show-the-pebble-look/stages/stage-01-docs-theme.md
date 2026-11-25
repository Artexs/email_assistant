# F171 stage 01 — Docs accent, font and dark a11y

Needs F166 stage 03: the two font files in `apps/web/src/assets/fonts/` and their `@font-face` rules and `--font-sans` in `apps/web/src/styles/global.css`. May run next to 03, 04, 05. Stage 02 needs its `testMatch` change.

Part of [`../plan.md`](../plan.md). Decisions P1, P2, D1, D2, D8, D12.

## Step 1 — Accent

- **Files:** `apps/docs/src/styles/custom.css` (already in Starlight `customCss`; do not add a second file to `astro.config.mjs`, stage 02 edits that file).
- **Do:** set the three accent variables of D1 for the dark default (`:root`) and for `:root[data-theme='light']`, the same selectors as Starlight's `props.css`. No other Starlight variable changes (P1). The shot box rules stay.

## Step 2 — Font

- **Files:** `custom.css`.
- **Do:** two `@font-face` rules for `"Nunito Variable"` (D2): relative `url()` to `apps/web/src/assets/fonts/<file>.woff2`, `format("woff2-variations")`, `font-weight: 200 1000`, `font-display: swap`, and the `unicode-range` of the same file in `global.css`. Set `--sl-font` to the panel's `--font-sans` list. `--sl-font-mono` stays.
- **Check:** after `bun run docs:build`, the built CSS names `/_astro/…woff2` under the docs base, and no page asks for another host (CSP `font-src 'self'` stays as it is).

## Step 3 — Dark a11y pass

- **Files:** `apps/docs/e2e/playwright.config.ts` (`testMatch` from `"site.spec.ts"` to `"*.spec.ts"`, so that each stage adds its own spec file and `site.spec.ts` keeps one owner), new `apps/docs/e2e/theme.spec.ts`.
- **Interface** (stage 02 uses it): every `apps/docs/e2e/*.spec.ts` runs in `docs:test`.
- **Do:** for each page of the D8 list, open it in a context with `colorScheme: "dark"` at desktop size, check that `document.documentElement.dataset.theme` is `"dark"`, then run `expectNoA11yViolations`. Name the tests `F171-01 <path> has no accessibility violation in the dark scheme`.

## Test

New unit test `apps/docs/src/theme.test.ts`. It reads `custom.css`, and the gray, white and black values of Starlight from `node_modules/@astrojs/starlight/dist/style/props.css` (a Starlight update then checks again).

1. The six accent values equal D1 exactly.
2. Contrast under D12 (each `hsl()` channel rounded to 8 bits, then WCAG; two decimals): light accent on white `5.59`, light accent on light gray-6 `4.82`, white on light accent `5.59`, light accent-high on light accent-low `9.07`; dark accent-high on dark black `9.32`, on dark gray-6 `7.94`; dark accent-low on dark accent-high `6.48`. Each pair also ≥ 4.5.
3. Break check: set light `--sl-color-accent` to `#13a08c`; test 2 fails on "light accent on white"; restore.
4. Each `url()` in a `@font-face` rule of `custom.css` resolves (from the CSS file's folder) to an existing file in `apps/web/src/assets/fonts/`, the two files are both used, and the `unicode-range` of each rule equals that of the rule in `global.css` with the same file name.
5. `--sl-font` begins with `"Nunito Variable"`.

e2e, in `theme.spec.ts`:

6. The dark pass of step 3 has no violation on the D8 list (8 English pages and their Polish pages).
7. On the home page, `getComputedStyle(document.body).fontFamily` begins with `"Nunito Variable"`, and after `document.fonts.ready` the check `document.fonts.check('16px "Nunito Variable"')` is `true`.
8. Today's light T4 and F121-12 passes of `site.spec.ts` stay green with the new accent, and the `docs:test` log lists `site.spec.ts` and `theme.spec.ts`.

## Look

Open the home page and `how-to/sender-rules` in both schemes (`bun run docs:build`, then `bun apps/docs/e2e/serve.ts`, or Playwright screenshots into `/tmp/f171-01/`). Give the paths. A link, the current sidebar item and the search button must show teal; Polish letters must use Nunito.

## Out of scope

The mark and the favicon (stage 02). Page texts (stage 03). Starlight grays, sizes and the theme select (P1, P2). The panel's CSS.

## Done when

- Tests 1–8 pass; test 3 failed when broken.
- The Proof of `../plan.md` prints `PROOF_OK`.
