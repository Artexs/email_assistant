# F118 stage 08b — Push rows in the outbox readers `[risky]`

Part of [`../plan.md`](../plan.md). Needs 08. No migration.

Carry-over reads: `plan.md` D7, D22, D23; `plan-review-1.md` T1, T3; `digest-and-notices.md` rules 6, 13; `drafts-and-send.md` (F079 `timeout` or `not_seen`); `channels/card-edits-repo.ts`, `actions/repo/approvals.ts`, `channels/repo.ts`.

Some readers find a notice by the exact Telegram dedup key; a push row's key is `<key>:push:<device id>`, so they miss it.

## Step 1 — Readers of a dedup key (D22)

- **Goal:** each reader below also matches the push rows of the same event (`dedup_key = <key> OR dedup_key LIKE '<key>:push:%'`, or an equal form; the worker picks the query; mind the `LIKE` escape of `_` and `%`).
  - **Card fail of an answered approval** (`failPendingCardsOfSend` and its callers): a `pending` push row of `approval:<send id>` becomes `failed` / `answered_elsewhere` in the same transaction as the decision, so no push for a decided send goes out (for example at 07:00 after quiet hours). A `sending` push row is left (it may go out once; the tap opens the approvals page, which shows the decided state).
  - **The F079 "request seen" check** (`requestSent`, `listUnseenApprovalSends`, and the resume path that reads them): a `sent` push row of the approval counts as a request that reached an owner, as a sent Telegram card does.
  - **`sync_ok` episodes** (`listSentStaleEpisodes`): a `sent` push `sync_stale` row starts an episode for that owner; the `sync_ok` for that owner is queued through `queueNotice` with its route, so it goes by push when the stale notice did.
- **Other readers:** grep every query that compares `outbox.dedup_key` with a fixed key or filters `channel = 'telegram'` outside the Telegram sender. List each in the final message with "push counts" or "Telegram only" and the reason. A reader not named here that needs a behaviour change is a question, not a choice.
- **Test (integration):**
  1. Owner with one device; approval pending with a Telegram card `sent` and a push row `pending` (quiet hours); the owner approves in the panel → the push row `failed` / `answered_elsewhere`; the card edit row as today.
  2. Push-only owner; the push row of an approval is `sent`; the send expires → its end state is `timeout` (request seen), not `not_seen`.
  3. Same with the push row still `pending` at expiry → `not_seen`.
  4. Push-only owner gets a `sync_stale` push; the sync is fresh again → one `sync_ok` push row; a second run → no new row.
  5. A key that holds `_` (a UUID does not; use a test key `a_b`) does not match `axb:push:1` (escape check).

## Step 2 — Fallback to Telegram (D23)

- **Goal:** a push row that ends `failed` / `no_device` (device ended, expired, gone, or removed) queues the Telegram row of its event when the member has a chat link and no row with the event's Telegram key exists. The fallback uses the same kind, view and locale (the row's view is the event's facts), the key without the `:push:<id>` part, and the member's current detail at send time.
- **Decisions:** only `no_device` falls back; `push_refused`, `expired`, `too_many_errors` do not (they mean a broken device or an old event). A fallback row of a kind that is not in `pushKinds` cannot exist. An approval that is already decided makes its fallback card `answered_elsewhere` through step 1.
- **Test (integration):**
  1. Member with a chat, route `urgent: push`, one device; the urgent push row is held by quiet hours; the session ends at 03:00 → at 07:00 the push row is `failed` / `no_device` and one Telegram `urgent:<id>` row exists.
  2. Same, with a Telegram row of the event already there (route `both`) → no second Telegram row.
  3. Push-only member (no chat) → no fallback row; the push row stays `failed` / `no_device`.
  4. A 400 answer (`push_refused`) → no fallback row.
- **Mutation guard:** remove the push match in the card fail; test 1 of step 1 fails. Remove the chat check of the fallback; test 3 of step 2 fails. List both.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the M5 metric and SLO (Telegram only, Q11); Telegram detail (09–12).
