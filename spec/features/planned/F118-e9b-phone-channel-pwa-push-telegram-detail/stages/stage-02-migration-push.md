# F118 stage 02 — Migration A: devices and routes `[risky]`

Part of [`../plan.md`](../plan.md). Needs 01. **Migration**: no other migration in the repo at the same time. Owner step after the land: `bun run db:migrate` on the shared dev DB.

Carry-over reads: `plan.md` D3, D4, D7, D9, D16; `plan-review-1.md` B1; `interfaces.md` § Server (table, repo, outbox column); `20261115180001_trust_ladder.sql` (CHECK widening and its `down`); `privacy/`; `platform/crypto.ts`.

## Step 1 — Migration

- **Goal:** one dbmate file `db/migrations/<ts>_push_devices.sql` with `up` and `down`.
- **Shape:**
  - `push_subscriptions` as D3. `UNIQUE (user_id, endpoint_hash)`. FK `(org_id, user_id)` → `memberships` ON DELETE CASCADE; `session_id uuid NULL` → `auth_sessions (id)` ON DELETE SET NULL (null = the session ended; the device is not live). Index `(org_id, user_id)` and `(session_id)`. `device_label` CHECK length ≤ 60. `last_error_code` CHECK `~ '^[a-z0-9_]{1,40}$'` or null.
  - `outbox`: widen `outbox_channel_check` to `('telegram','mail','push')`; add `push_subscription_id uuid NULL REFERENCES push_subscriptions (id) ON DELETE SET NULL` with an index; CHECK `push_subscription_id IS NULL OR channel = 'push'`. A push row whose device is gone keeps its history (sent rows feed the M5 metric and the F079 check).
  - `memberships.notice_routes jsonb NOT NULL DEFAULT '{}'`, CHECK `jsonb_typeof = 'object'`.
  - `down`: delete `outbox` rows with `channel = 'push'` first, then drop the column, the constraint change, `notice_routes`, the table.
- **Decisions:** D3, D4, D7. Endpoint and keys live only in the ciphertext; `endpoint_hash` = sha256 hex of the endpoint.
- **Test (integration, schema):**
  1. A Telegram row with a `push_subscription_id` → CHECK error.
  2. Delete the session → the subscription stays with `session_id` null; its sent and pending push rows stay.
  3. Delete the membership → subscriptions of that org and user gone, their outbox rows keep with a null device; the same user's subscription in another org stays.
  4. Two rows with the same `(user_id, endpoint_hash)` → unique error.
  5. `notice_routes = '[]'` → CHECK error.
  6. Migrate down then up on a DB with one push row → no error.

## Step 2 — Repository and privacy maps

- **Goal:** the repo of interfaces.md in `apps/server/src/modules/channels/push/repo.ts`. Every query filters by `org_id` from `TenantContext`.
- **Interfaces:** `upsertPushSubscription(trx, ctx, { userId, sessionId, endpoint, p256dh, auth, deviceLabel, box, now, rebindOnly })` → `{ id, created } | null`: an existing `(user, endpoint_hash)` gets the new session, keys and label (re-bind); `rebindOnly` and no such row → null, nothing stored (D16); a new one beyond 10 rows of the user removes the oldest first (D3). `listLiveDeviceIds(trx, ctx, userId, now)` → `{ id, createdAt }[]` (session not null and `expires_at > now`, D9; no secret). `loadDeviceSecret(trx, ctx, id, box)`. `listDeviceViews` (live devices, no secret, for the API). `removeDevice(trx, ctx, id)`: fails the device's `pending` and `sending` push rows `failed` / `no_device`, then deletes the device (add `no_device` to `outboxFailCodes`). `markPushSuccess`, `markPushError(code)`. `pushDedupKey(key, subId)`.
- **Decisions:** encrypt with the ADR 0009 box, AAD `push:<id>` (generate the id before the insert). A decrypt failure logs `push_subscription_id` only and calls `removeDevice`.
- **Privacy:** `push_subscriptions` in `export-map.ts` as `secret(...)` (the export never holds the ciphertext), and in the address map and data categories as their tests require. `notice_routes` goes with `memberships`.
- **Test (integration):**
  1. Upsert twice with the same endpoint and two sessions → one row, `session_id` = the second, `created` false. `rebindOnly` with an unknown endpoint → null, no row; with user B and A's endpoint → null, A's row unchanged.
  2. 11 endpoints → 10 rows; the oldest is gone; its pending row is `failed` / `no_device`.
  3. `listLiveDeviceIds` leaves out a row whose session `expires_at` is in the past and a row with `session_id` null.
  4. `removeDevice` with one pending and one sent row → the pending row `failed` / `no_device`, the sent row stays `sent` with a null device.
  5. Org B context cannot read, delete or re-bind org A's row (returns empty or false).
  6. The stored `secret` column holds none of the endpoint text (planted value `CANARYENDPOINT`).
  7. `privacy-export-map` and account delete tests pass with the new table; an org delete removes its rows.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** routes (03), queueing (07), the sender (08), the Telegram detail columns (10).
