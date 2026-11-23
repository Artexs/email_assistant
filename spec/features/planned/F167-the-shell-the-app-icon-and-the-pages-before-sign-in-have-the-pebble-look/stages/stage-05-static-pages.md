# F167 stage 05 — Legal reading frame, 404, offline, `/` and the offline cache

Part of [`../plan.md`](../plan.md). Needs stage 04: the `frame` prop of `Public.astro`. Needs F166 stage 03: the font files in the CSS bundle. May run next to 02, 03.

This stage owns the legal page and `components/legal/*.astro`, the 404, offline and `/` pages, the `reading` branch of `Public.astro`, and the service worker with its build script.

## Step 1 — The static pages

- **Decisions:** D10, D14.
  - `reading`: a column of at most 768 px; `BrandMark` and the brand name at the top, a link to `/login`; the text in one card-look block (radius `lg`, `shadow-card`, padding 24 px, 16 px below `lg`); `h1` `text-3xl` from `lg`, `text-2xl` below. The `.legal-*` CSS does not change (D14); the draft line, version line, tables and sign-in link keep their `data-legal` attributes, roles and texts.
  - `404` and offline: the `card` frame; one card with an icon tile (`bg-primary-soft text-primary`; `SearchX`, `WifiOff`), the Polish block then the English block as today, each link a full-width button look (`bg-primary text-primary-foreground`, radius full, 48 px). One `h1` (Polish) as today; the English title stays a `p`.
  - `/`: the `card` frame; the meta refresh and the bilingual link stay; the link has the button look.
- **Edge cases:** at 320 px no sideways scroll; a wide legal table scrolls inside `.legal-table`.

## Step 2 — The offline page keeps its look with no network

- **Decisions:** D13.
  - `scripts/build-sw.ts`, after `astro build`: read `dist/offline.html`, collect each `/_astro/` file it links, then each `/_astro/` URL in a `url(...)` of those CSS files (the fonts). Fail the build (exit 1, a `createCliOutput` line) when it links no CSS file or a listed file is missing in `dist`. Pass `{ assets, version }` (the sorted list and `v2-` + an 8-character hex hash of it) into the bundle with Bun's `define` as the global `__EA_SHELL__`; `sw/sw.ts` passes it to `installWorker`.
  - `lib/service-worker.ts`: `installWorker(scope, shell: { assets: readonly string[]; version: string })`. Install adds `/offline.html` and every asset to the cache `ea-shell-<version>`. `activate` deletes every `ea-shell-` cache but the current one, as today. The fetch rules do not change. Pure and tested without a browser: `offlineAssets(html: string, cssByPath: Record<string, string>): string[]` (the build script calls it).
  - `SW_VERSION` becomes the version prefix `v2`; the cache name is `ea-shell-v2-<hash>`.
- **Edge cases:** a deploy with new hashes makes a new cache; the next `activate` deletes the old one. An asset that fails at install fails the install (`cache.addAll`); the old worker stays.

## Step 3 — Capability page

`docs/capabilities/web-panel.md`, the installable shell rule: the precache list and the cache name.

## Test

1. Unit `service-worker.test.ts`: `offlineAssets` on `<link rel="stylesheet" href="/_astro/a.css">` with the CSS `@font-face{src:url(/_astro/n.woff2)}` gives `["/_astro/a.css", "/_astro/n.woff2"]`; `http://` and `data:` URLs are left out; sorted, no duplicate.
2. Unit: install with `assets` `["/_astro/a.css"]` and version `v2-abcd1234` adds both paths to `ea-shell-v2-abcd1234`; `staleCaches(["ea-shell-v1", "ea-shell-v2-abcd1234", "other"], "ea-shell-v2-abcd1234")` gives `["ea-shell-v1"]`.
3. Unit `integrations/pwa-shell.test.ts`, the bundle test: it builds `src/sw/sw.ts` with `define` `__EA_SHELL__` = `{ assets: ["/_astro/a.css"], version: "v2-00000000" }`; the code holds `/_astro/a.css` and `ea-shell-v2-00000000`, and still no `import` and no `node:`. A pure test of the build helper: an `offline.html` with no stylesheet gives the error, and a listed file missing from `dist` gives the error.
4. e2e `pwa.spec.ts`, the signed-in test: the cache name matches `/^ea-shell-v2-[0-9a-f]{8}$/`; it holds `/offline.html`, a `.css` and a `.woff2` path; every path is `/offline.html` or under `/_astro/`.
5. e2e `pwa.spec.ts`, new: a fresh context signs in (the worker registers on the first panel page), waits for `navigator.serviceWorker.ready`, goes offline, opens `/settings`: the `h1` is `pl.offline_title`; `getComputedStyle(body).fontFamily` starts with `"Nunito Variable"`; `document.fonts.check('16px "Nunito Variable"')` is true; the card background is `rgb(255, 255, 255)`.
6. `legal.spec.ts`, `auth.spec.ts` (404) and `pwa.spec.ts` pass with their a11y scans.

## Out of scope

The legal texts and the `.legal-*` CSS. A cache for panel pages or `/api` (never).

## Done when

You opened a legal page, 404 and offline in both schemes, phone and desktop (the contact sheet, or your own screenshots if it has no public routes; name the paths); the Proof of `../plan.md` with the specs `pwa.spec.ts legal.spec.ts auth.spec.ts` prints `PROOF_OK`.
