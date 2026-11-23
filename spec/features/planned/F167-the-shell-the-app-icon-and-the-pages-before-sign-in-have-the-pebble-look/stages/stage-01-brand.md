# F167 stage 01 — Brand mark, app icons and browser colour

Part of [`../plan.md`](../plan.md). Needs F166 stage 03: the light and dark token values in `apps/web/src/styles/global.css` (test 2 compares against them). May run next to 03.

## Step 1 — The mark

- **Files:** `apps/web/src/components/shell/BrandMark.tsx` (new).
- **Interface** (stages 02, 04 and 05 use it):
  ```ts
  BrandMark({ size?: "sm" | "default" | "lg"; tone?: "primary" | "inverse" })
  // sm 32 px, default 36 px, lg 48 px; radius in the ratio 12 12 12 4 of 36 px; lucide Mail icon at about 50 % of the tile.
  // primary: bg-primary text-primary-foreground. inverse: bg-primary-foreground text-primary (on the login panel).
  // The root is aria-hidden: the brand name next to it is the text a reader gets.
  ```
- **Decisions:** D4. Token classes only. It must also render in a static Astro page (no hook, no `t()`).
- **Test:** (1) a render test in `apps/web/src/lib/`: the root has `aria-hidden="true"`; `size="lg"` gives the 48 px class; `tone="inverse"` gives `bg-primary-foreground`.

## Step 2 — Icons from one source

- **Files:** `apps/web/brand/mark.svg` (new), `apps/web/scripts/build-icons.ts` (new), the `icons` script in `apps/web/package.json`, the PNG files in `apps/web/public/`.
- **Decisions:** D5. The SVG draws the tile shape of D4 in `#0a7568` with the envelope in `#ffffff`. The script renders it with the Chromium of `@playwright/test` and writes:
  - `favicon.png` 32 px, `icons/icon-192.png`, `icons/icon-512.png`: the tile, transparent outside it;
  - `icons/icon-512-maskable.png`: a full teal square, the envelope inside the central 60 % (the maskable safe zone);
  - `icons/apple-touch-icon.png` 180 px: a full teal square, the envelope at the size of the maskable one.
  The PNG files are committed; the build does not run the script. The script prints through `createCliOutput`, like `build-sw.ts`.
- **Test:** (2) a unit test reads `brand/mark.svg` and `global.css`: the two fills of the SVG equal light `--primary` and light `--primary-foreground`. (3) `pwa-shell.test.ts` keeps its icon checks; it adds that `apple-touch-icon.png` is 180 × 180.

## Step 3 — Manifest and browser colour

- **Files:** `apps/web/public/manifest.webmanifest`, `apps/web/src/layouts/App.astro`, `apps/web/src/layouts/Public.astro` (the head tags only; stage 04 changes the body of `Public.astro`).
- **Decisions:** D6. Each layout has two `theme-color` tags, `media="(prefers-color-scheme: light)"` `#0a7568` and `media="(prefers-color-scheme: dark)"` `#0d1513`, and the apple-touch link points at `/icons/apple-touch-icon.png`. Manifest `theme_color` `#0a7568`, `background_color` `#f3f6f5`; the icon list does not change. If the F166 colour scan names the old single `theme-color` in its allow list, update that entry to the two new values in this stage.
- **Test:** (2b) in `pwa-shell.test.ts`: both layouts hold exactly these two `theme-color` tags; the light value equals light `--primary` of `global.css`, the dark value equals dark `--background`; the manifest `theme_color` equals light `--primary`, `background_color` light `--background`. Break check: set the dark tag to `#0a7568`; the test fails; restore.
- **Test:** (4) e2e in `pwa.spec.ts`: draw each icon in a canvas on the page and read pixels: `icon-192.png` at (96, 12) is `rgb(10, 117, 104)` ±2 per channel and at (1, 1) has alpha 0; `icon-512-maskable.png` and `apple-touch-icon.png` at (2, 2) are `rgb(10, 117, 104)` ±2 with alpha 255; `favicon.png` at (16, 2) is the teal ±2. `/icons/apple-touch-icon.png` answers 200 with no session.

## Step 4 — Capability page

`docs/capabilities/web-panel.md`: one line on the brand (the mark, the icon source and `bun run --filter @ea/web icons`, the two browser colours).

## Out of scope

The sidebar, the phone header and the login panel that show the mark (stages 02, 04). The docs site mark (F171).

## Done when

The Proof of `../plan.md` prints `PROOF_OK` with the specs `pwa.spec.ts auth.spec.ts`, and the final message gives the paths of the five PNG files and of the contact sheet pictures of `login` you opened.
