# F118 stage 04 — PWA shell

Part of [`../plan.md`](../plan.md). Needs 03.

Carry-over reads: `plan.md` D5, D15, D17; `interfaces.md` (`PushPayload`, `pushTexts`, `noticePath`); `apps/web/astro.config.mjs` (CSP), `apps/server/src/platform/http.ts` (`PUBLIC_PAGE_PATHS`, `serveStatic`, cache headers); `docs/capabilities/web-panel.md` rules 1–2; the `web:build` script.

## Step 1 — Core pieces the worker bundles

- **Goal:** pure functions in `packages/core` that both the service worker and the server use.
- **Files:** `packages/core/src/notices/push.ts` (`PushPayload`, `pushPayloadSchema`, `noticePath`, `noticeGroups`, `pushKinds`, `noticeGroupOf` per D6), `packages/core/src/texts/push.ts` (`pushTexts(lang)`: title and body per push kind and `test`, with counts; en and pl, Polish plural forms).
- **Decisions:** D17 map. A body holds the kind phrase and the count only ("1 urgent mail", "3 drafts wait for you"; pl "1 pilna wiadomość", "3 szkice czekają"). `noticePath` with an `itemId` that is not a UUID returns the path without the id.
- **Test (unit):**
  1. `noticePath("approval", "<uuid>")` = `/approvals?id=<uuid>`; `noticePath("approval", "x y")` = `/approvals`; `noticePath("urgent", null)` = `/activity?category=urgent`; `noticePath("auth_error", null)` = `/mailboxes`.
  2. `pushPayloadSchema` refuses an extra key `subject` and a `count` of -1.
  3. `pushTexts("pl")` has a title and body for every push kind and `test`; counts 1, 2, 5 give the three Polish plural forms for `urgent`.
  4. The stage 03 test payload literal passes `pushPayloadSchema`; every kind of `pushKinds` is in exactly one group.

## Step 2 — Manifest, icons, service worker

- **Goal:** the panel is installable and shows a push.
- **Files:** `apps/web/public/manifest.webmanifest`, icons (192, 512, 512 maskable PNG, made from the existing favicon art), `apps/web/public/offline.html` (static, en and pl text, no data), `apps/web/src/sw/sw.ts`, a `Bun.build` step in `web:build` that writes `WEB_DIST/sw.js`; the layout links the manifest and registers `/sw.js` (scope `/`).
- **Decisions:** D15. The worker:
  - `install`: caches `/offline.html` only. `activate`: deletes caches of older versions (a version constant).
  - `fetch`: `/_astro/*` cache first; a navigation goes to the network, `/offline.html` on a network error; every other request (including `/api/*`) is not handled (`respondWith` is not called).
  - `push`: parse with `pushPayloadSchema`; a bad payload shows nothing. `showNotification(title, { body, tag: payload.id, data: { path } })` with `pushTexts(lang)` and `noticePath`.
  - `notificationclick`: focus an open panel window and navigate it to `path`, else open `path`.
- **Server:** add `/manifest.webmanifest`, `/sw.js`, `/offline.html`, `/icons/` to `PUBLIC_PAGE_PATHS`; content types `application/manifest+json` and `text/javascript`; `/sw.js` gets `Cache-Control: no-cache`. Add `worker-src 'self'` and `manifest-src 'self'` to the CSP (D15): `worker-src` falls back to `script-src`, which Astro fills with hashes (review N5).
- **Test:**
  1. (unit, worker logic split into pure functions) the fetch rule: `/api/me` → not handled; `/_astro/a.js` → cache first; a navigation → network with fallback.
  2. (unit) the push handler with payload `{v:1,id:"r1",kind:"urgent",count:2,itemId:null,lang:"en"}` → title and body of `pushTexts("en")`, `tag` "r1", path `/activity?category=urgent`; with an extra key → no notification.
  3. (integration, server) `GET /sw.js` and `GET /manifest.webmanifest` without a session → 200 with the content types; `GET /activity` without a session still redirects.
  4. (e2e, under the flock) Chromium: the worker registers, the manifest parses with `start_url` `/activity` and `display` `standalone`, `expectNoA11yViolations` on `/offline.html`.
- **Check:** the touched tests, `bun run web:build`, then the Proof and `flock /tmp/email-assistant-shared-tests.lock bun run test:e2e > /tmp/f118-s04/e2e.log 2>&1` (add `&& ` before `echo PROOF_OK`).
- **Done when:** the Proof with the e2e step prints `PROOF_OK`.
- **Out of scope:** the subscribe button and install help (05).
