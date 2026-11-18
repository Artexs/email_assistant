# F118 stage 02 — Migration A: devices and routes `[risky]`

Part of [`../plan.md`](../plan.md). Needs nothing (may run before 01 lands only if the coordinator wants; default: after 01). **Migration**: no other migration in the repo at the same time. Owner step after the land: `bun run db:migrate` on the shared dev DB.

Carry-over reads: `plan.md` D3, D4, D7; `interfaces.md` § Server (table, repo, outbox column); the newest migrations (`20261115180001_trust_ladder.sql` for the CHECK widening and its `down`); `privacy/export-map.ts`, `privacy/address-map.ts`, `privacy/delete.ts`; `platform/crypto.ts`.

## Step 1 — Migration

- **Goal:** one dbmate file `db/migrations/<ts>_push_devices.sql` with `up` and `down`.
- **Shape:**
  - `push_subscriptions` as D3. `UNIQUE (user_id, endpoint_hash)`. FK `(org_id, user_id)` → `memberships` ON DELETE CASCADE; `session_id` → `auth_sessions (id)` ON DELETE CASCADE. Index `(org_id, user_id)` and `(session_id)`. `device_label` CHECK length ≤ 60. `last_error_code` CHECK `~ '^[a-z0-9_]{1,40}$'` or null.
  - `outbox`: widen `outbox_channel_check` to `('telegram','mail','push')`; add `push_subscription_id uuid NULL REFERENCES push_subscriptions (id) ON DELETE CASCADE`; CHECK `(channel = 'push') = (push_subscription_id IS NOT NULL)`.
  - `memberships.notice_routes jsonb NOT NULL DEFAULT '{}'`, CHECK `jsonb_typeof = 'object'`.
  - `down`: delete `outbox` rows with `channel = 'push'` first, then drop the column, the constraint change, `notice_routes`, the table.
- **Decisions:** D3, D4, D7. The table holds secrets (endpoint and keys): only the ciphertext column; `endpoint_hash` is sha256 of the endpoint for dedup (the endpoint has a high-entropy token, so the hash is not reversible).
- **Test (integration, schema):**
  1. Insert a push outbox row without `push_subscription_id` → CHECK error; a Telegram row with one → CHECK error.
  2. Delete the session → its subscription and its pending push rows are gone; a Telegram row of the same user stays.
  3. Delete the membership → subscriptions of that org and user gone; the same user's subscription in another org stays.
  4. Two rows with the same `(user_id, endpoint_hash)` → unique error.
  5. `notice_routes = '[]'` → CHECK error.
  6. Migrate down then up on a DB with one push row → no error.

## Step 2 — Repository and privacy maps

- **Goal:** the repo of interfaces.md in `apps/server/src/modules/channels/push/repo.ts`. Every query filters by `org_id` from `TenantContext`.
- **Interfaces:** `upsertPushSubscription(trx, ctx, { userId, sessionId, endpoint, p256dh, auth, deviceLabel, box, now })` → `{ id, created: boolean }`: an existing `(user, endpoint_hash)` gets the new session, keys and label (re-bind, D16); a new one beyond 10 live rows of the user deletes the oldest first (D3). `listLiveDevices(trx, ctx, userId, now)` joins `auth_sessions` with `expires_at > now` (D9) and decrypts; `listDeviceViews` (no secret, for the API); `deletePushSubscription(trx, ctx, userId, id)` → boolean; `markPushSuccess`, `markPushError(code)`. `pushDedupKey(key, subId)`.
- **Decisions:** encrypt with the ADR 0009 box, AAD `push:<id>` (generate the id before the insert). A decrypt failure is logged with `push_subscription_id` only and the row is treated as gone.
- **Privacy:** `push_subscriptions` in `export-map.ts` as `secret("secrets: push endpoint and keys")` or the members form with the secret column left out (the worker picks what the map test accepts; the export never holds the ciphertext). Add it to the address map and data categories as the map tests require. `notice_routes` is exported with `memberships`.
- **Test (integration):**
  1. Upsert twice with the same endpoint and two sessions → one row, `session_id` = the second, `created` false.
  2. 11 endpoints → 10 rows; the oldest is gone.
  3. `listLiveDevices` leaves out a row whose session `expires_at` is in the past.
  4. Org B context cannot read, delete or re-bind org A's row (returns empty or false).
  5. The stored `secret` column holds none of the endpoint text (planted value `CANARYENDPOINT`).
  6. `privacy-export-map` and account delete tests pass with the new table; an org delete removes its rows.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** routes (03), queueing (06), the sender (07), the Telegram detail columns (09).
