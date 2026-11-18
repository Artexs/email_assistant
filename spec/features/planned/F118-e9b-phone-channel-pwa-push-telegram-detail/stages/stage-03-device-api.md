# F118 stage 03 — Device API `[risky]`

Part of [`../plan.md`](../plan.md). Needs 01, 02.

Carry-over reads: `plan.md` D3, D9, D16, D18, D19; `interfaces.md` (routes, flag, audit events); `docs/code-patterns.md` § Add a user command; `channels/routes.ts` (the `/me/notify` routes as a model); `platform/http.ts` (`sessionId` in the context); `docs/capabilities/web-panel.md` rule 6.

## Step 1 — Flag and routes

- **Goal:** the member manages the push devices of their own user in the current organization.
- **Files:** `packages/core/src/web/push.ts` (schemas), `apps/server/src/modules/channels/push/routes.ts` and its `apiDoc`, the flag `web_push` in `featureFlags` (epic E9, remove-by 2027-06-01, default off).
- **Interfaces:**
  - `GET /api/me/push` → `{ vapidPublicKey: string | null, devices: [{ id, label, createdAt, lastSuccessAt, thisSession: boolean }] }`. `vapidPublicKey` null when `pushConfigOf` is null.
  - `PUT /api/me/push/subscription` body strict `{ endpoint: string (≤ 1024), keys: { p256dh: string (≤ 100), auth: string (≤ 50) } }` → `{ id }`. Binds to the session of the request (D16). `400 push_host_not_allowed` / `validation` from `checkPushEndpoint`. `409 push_off` when VAPID keys are not set.
  - `DELETE /api/me/push/devices/:id` → 204; another user's or org's id → 404.
  - `POST /api/me/push/test` → `{ sent: n }`: sends one payload `{ v: 1, id: <random uuid>, kind: "test", count: 1, itemId: null, lang }` (a literal here; stage 04 adds `pushPayloadSchema` and a test that this literal passes it) directly (no outbox row) to the devices of the current session; `gone` deletes the device. At most 5 per user per hour → `429 push_test_limit`.
  - The flag middleware runs first: flag off → 404 for every route, every role.
- **Decisions:** any member, own user only. The device label comes from the `User-Agent` of the PUT (browser and OS words, ≤ 60 chars, never the full string). Audit `push.subscribed` (data: device id, `created`) and `push.removed` (device id, `via: web`). Re-binding the same endpoint writes `push.subscribed` with `created: false`. Suspended org: writes refused as for other routes (`refuseSuspendedWrites`). The test send runs outside a transaction; the device delete after `gone` is its own transaction.
- **Test (integration):**
  1. Flag off → 404 for GET, PUT, DELETE and POST test.
  2. PUT a valid FCM endpoint → GET lists one device with `thisSession: true`; the audit row holds no endpoint.
  3. PUT `https://example.com/x` → 400 `push_host_not_allowed`; nothing stored.
  4. User B in the same org: DELETE of A's device → 404; A's device stays.
  5. Sign-out (`/api/auth/sign-out`), `revoke-other-sessions` from another session, and a password reset with `revokeSessionsOnPasswordReset` each remove the devices of the ended sessions (`listDeviceViews` empty for them). If Better Auth does not delete the row in one of them, stop and report (plan § Not verified).
  6. POST test with a fake push fetch answering 201 → `sent: 1`; answering 410 → `sent: 0` and the device is gone; the 6th call in an hour → 429.
  7. No log line of the run holds the planted endpoint `https://fcm.googleapis.com/fcm/send/CANARYPUSH` or the planted key (log capture helper).
- **Mutation guard:** for each guard (flag middleware, own-user filter, org filter, host check), remove it, see its test fail, restore it; list them in the final message.

## Step 2 — Fetch injection

- **Goal:** the composition root (`web.ts`) gives the push routes `deps.fetch = fetch` and the VAPID keys; tests pass a fake. No other outside call.
- **Test:** covered by step 1 cases 6 and 7.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the manifest and worker (04), the card (05), notices by push (06–08).
