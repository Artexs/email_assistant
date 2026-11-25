# F167 stage 07 — The offline page keeps its look with no network

Part of [`../plan.md`](../plan.md). Needs F166 stage 03: the font files in the CSS bundle. Needs F166 stage 08: `web:build:dev` and `patterns.spec.ts` (the Proof). May run next to 01 to 06.

This stage owns `apps/web/src/lib/service-worker.ts`, `apps/web/src/sw/sw.ts` and `apps/web/scripts/build-sw.ts`. It does not edit the offline page (stage 06). It works with any look of that page: it caches the files the built page links.

## Step 1 — The build script makes the precache list

- **Decisions:** D13. After `astro build`, `build-sw.ts` reads `dist/offline.html`, collects each `/_astro/` file it links, then each `/_astro/` URL in a `url(...)` of those CSS files (the font files).
- It fails the build (exit 1, a `createCliOutput` line) when the page links no CSS file or when a listed file is missing in `dist`.
- It passes `{ assets, version }` into the bundle with Bun's `define`, as the global `__EA_SHELL__`. `assets` is the sorted list. `version` is `v2-` plus 8 hex characters of a hash over the bytes of `dist/offline.html` and of each listed file, so a change of the offline text alone also makes a new worker.
- **Interface:** pure, tested without a browser: `offlineAssets(html: string, cssByPath: Record<string, string>): string[]` and `shellVersion(files: { path: string; bytes: Uint8Array }[]): string`.

## Step 2 — The worker installs the list

- **Interface:** `installWorker(scope, shell: { assets: readonly string[]; version: string })`; `sw/sw.ts` passes `__EA_SHELL__`.
- **Decisions:** install adds `/offline.html` and every asset to the cache `ea-shell-<version>` with `cache.addAll`. `activate` deletes every `ea-shell-` cache but the current one, as today. The fetch rules do not change. `SW_VERSION` becomes the prefix `v2`.
- **Edge cases:** a deploy with new hashes or a new offline text makes a new cache; the next `activate` deletes the old one. An asset that fails at install fails the install, and the old worker stays.

## Step 3 — Capability page

`docs/capabilities/web-panel.md`, the installable shell part of rule 2, and only there (D16): the precache list and the cache name.

## Test

1. Unit `service-worker.test.ts`: `offlineAssets` on `<link rel="stylesheet" href="/_astro/a.css">` with the CSS `@font-face{src:url(/_astro/n.woff2)}` gives `["/_astro/a.css", "/_astro/n.woff2"]`; `http://` and `data:` URLs are left out; sorted, no duplicate.
2. Unit: `shellVersion` matches `/^v2-[0-9a-f]{8}$/`; it changes when only the bytes of `/offline.html` change; it is the same for the same files in another order.
3. Unit: install with `assets` `["/_astro/a.css"]` and version `v2-abcd1234` adds `/offline.html` and `/_astro/a.css` to `ea-shell-v2-abcd1234`. `staleCaches(["ea-shell-v1", "ea-shell-v2-abcd1234", "other"], "ea-shell-v2-abcd1234")` gives `["ea-shell-v1"]`.
4. Unit: the build helper refuses an `offline.html` with no stylesheet, and a listed file that is missing from `dist`.
5. `integrations/pwa-shell.test.ts`, the bundle test: it builds `src/sw/sw.ts` with `define` `__EA_SHELL__` = `{ assets: ["/_astro/a.css"], version: "v2-00000000" }`; the code holds `/_astro/a.css` and `ea-shell-v2-00000000`, and still no `import` and no `node:`.
6. e2e `pwa.spec.ts`, the signed-in test: the cache name matches `/^ea-shell-v2-[0-9a-f]{8}$/`; every path is `/offline.html` or under `/_astro/`.
7. e2e `pwa.spec.ts`, new, proves the precache and not the run-time cache: a fresh context opens `/login` (its CSS and fonts load before any worker exists), registers `/sw.js` from the page and waits for `navigator.serviceWorker.ready`, goes offline, and opens `/settings`. The `h1` is `pl.offline_title`; `getComputedStyle(document.body).fontFamily` starts with `"Nunito Variable"`; `document.fonts.check('16px "Nunito Variable"')` is true. Break check: install only `/offline.html`; test 7 fails; restore.

## Out of scope

The look of the offline page (stage 06). A cache for panel pages or `/api` (never: the worker caches the shell only).

## Done when

The Proof of `../plan.md` with the spec `pwa.spec.ts` prints `PROOF_OK`, and the final message gives the precache list of your build and the result of the break check of test 7.
