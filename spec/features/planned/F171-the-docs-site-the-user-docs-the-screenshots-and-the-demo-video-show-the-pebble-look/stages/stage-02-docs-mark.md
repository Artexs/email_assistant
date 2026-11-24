# F171 stage 02 — Docs mark and favicon

Needs F167 stage 01: `apps/web/brand/mark.svg`, the one source of the brand mark. Needs stage 01: `testMatch` `*.spec.ts` in `apps/docs/e2e/playwright.config.ts` (test 4 is a new spec file). May run next to 03, 04, 05.

Part of [`../plan.md`](../plan.md). Decisions P1, D3.

## Step 1 — Favicon and logo

- **Files:** `apps/docs/public/favicon.svg` (replace), `apps/docs/src/assets/mark.svg` (new), `apps/docs/astro.config.mjs` (the Starlight `logo` option only).
- **Do:** copy `apps/web/brand/mark.svg` byte for byte to both files. Set Starlight `logo: { src: "./src/assets/mark.svg", alt: "", replacesTitle: false }`. The `favicon` option stays at its default `/favicon.svg`. The site title stays `PRODUCT_NAME`.
- **If** Starlight shows the logo in a wrong size or shape (Not verified in `../plan.md`), add a size rule for `.site-title img` to a new CSS file `apps/docs/src/styles/brand.css` in `customCss` (stage 01 owns `custom.css`). Say so in the final message.

## Step 2 — No drift

- **Files:** new unit test `apps/docs/src/brand.test.ts`.

## Test

1. `apps/docs/public/favicon.svg` and `apps/docs/src/assets/mark.svg` each have the same bytes as `apps/web/brand/mark.svg`.
2. Break check: add a space to `apps/docs/src/assets/mark.svg`; test 1 fails and names that file; restore.
3. `astro.config.mjs` holds the logo `src` `./src/assets/mark.svg` (read the file as text, as other tests of this folder do).
4. e2e, new `apps/docs/e2e/brand.spec.ts`, test `F171-02 the home page shows the mark next to the product name`: the header `img` in the site title has `alt=""`, its `src` ends in `.svg`, and the link text still holds the product name. The `<link rel="icon">` points at `<base>/favicon.svg`, and that URL answers 200 with `image/svg+xml`.
5. The light and dark a11y passes stay green (the image has an empty alt and a named link).

## Look

Open the home page at desktop and phone width in both schemes; give the paths. The mark must show its teal tile in both schemes and not be cut.

## Out of scope

The panel icons and `mark.svg` itself (F167). Accent and font (stage 01).

## Done when

- Tests 1–5 pass; test 2 failed when broken.
- The Proof of `../plan.md` prints `PROOF_OK`.
