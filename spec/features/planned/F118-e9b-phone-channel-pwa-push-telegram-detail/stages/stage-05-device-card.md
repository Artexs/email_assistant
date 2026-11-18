# F118 stage 05 — Account device card

Part of [`../plan.md`](../plan.md). Needs 04. Checkpoint A follows.

Carry-over reads: `plan.md` D9, D16; `interfaces.md` (routes of stage 03); `apps/web/src/islands/SettingsPage.tsx` and `components/settings/NotifyCards.tsx` (card pattern), `AccountCard.tsx`, `AppShell.tsx`; `docs/code-patterns.md` § Texts carry a locale.

## Step 1 — The card

- **Goal:** Settings → Account shows "Phone notices" when `me.features.web_push` is on.
- **Files:** `apps/web/src/components/settings/PushDevicesCard.tsx`, `apps/web/src/lib/push-client.ts`, `en.ts`, `pl.ts`.
- **Behaviour:**
  - Device list from `GET /api/me/push`: label, added date, last push, "this device" mark, Remove (confirm, then `DELETE`).
  - Button "Turn on notices on this device": shown when the browser has `PushManager` and `vapidPublicKey` is not null. It asks `Notification.requestPermission()`, then `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, then `PUT`. Denied permission → the text "Notices are blocked in the browser settings" and no request.
  - Button "Send a test notice" (`POST /api/me/push/test`) when this session has a device; toast with the count or the limit text.
  - Install help: Android Chrome → the install button from `beforeinstallprompt` when the event came; iOS → text "Share → Add to Home Screen, then open the app and turn on notices here (iOS 16.4 or later)"; installed (`display-mode: standalone`) → no help.
  - `vapidPublicKey` null → the text "Phone notices are not set up on this server" and no buttons.
- **Decisions:** member card (own user); read-only roles follow `canWrite(me)`. Texts en and pl.
- **Test:**
  1. (unit) `push-client.ts`: the base64url → `Uint8Array` key conversion for a fixed 65-byte key; the platform hint for three fixed user-agent strings (Android Chrome, iPhone Safari, desktop Firefox).
  2. (e2e, Chromium, flag on through the seed) the card lists a seeded device; Remove deletes it; with the flag off the card is absent; `expectNoA11yViolations`.

## Step 2 — Re-bind on load

- **Goal:** D16. On each panel load in `AppShell`, when `web_push` is on, `Notification.permission === "granted"` and `pushManager.getSubscription()` returns one, `PUT` it once per page load. A failure is silent (console only, no endpoint).
- **Test (unit):** the re-bind function with fakes: granted plus subscription → one PUT; `default` permission → no PUT; no subscription → no PUT.
- **Check:** the touched tests, `bun run web:build`, then the Proof with the e2e step as in stage 04.
- **Done when:** the Proof with the e2e step prints `PROOF_OK`.
- **Out of scope:** route choice (12), Telegram detail (12).

## Checkpoint A (owner, after the land)

Owner steps O1–O3 in `questions.md`: VAPID keys on the VPS, deploy, flag `web_push` on for the pilot org, install the panel on the Android phone, turn on notices, "Send a test notice". Pass: the notice shows on the locked phone within 30 s and its tap opens the panel. Fail → stop F118 and report (fallback: a WebCrypto library, a new stage 01b).
