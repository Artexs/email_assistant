# F118 stage 08 — Push render and sender `[risky]`

Part of [`../plan.md`](../plan.md). Needs 07. No migration.

Carry-over reads: `plan.md` D5, D9, D10, D18; `interfaces.md` (`noticeFactsOf`, `PushPayload`, `renderNotice` push, `createPushSender`, fail codes); `docs/capabilities/digest-and-notices.md` rules 3a, 3b, 7; `channels/sender.ts`, `channels/report-mail-sender.ts` (the second sender is the model), `channels/quiet-gate.ts`, `channels/repo.ts` (`claimDueOutbox`), `packages/core/src/notices/renderers.ts`, `render.ts`, `registry.test.ts`; `test/integration/log-canary.test.ts`.

## Step 1 — Facts and the push renderer (core)

- **Goal:** each push kind turns its view into `{ count, itemId }`; `renderNotice` with `channel: "push"` gives the payload JSON.
- **Files:** `packages/core/src/notices/facts.ts` (`noticeFactsOf`), the `push` entry of each push kind in `renderers.ts`, `noticeChannels` gains `push`.
- **Decisions:** `itemId`: approval, send_result → the action id; approval_set → the set id; delegation_answered → the delegation id; urgent, not_triaged → null (D17 opens the list; the email id never leaves the server); others → null. `count`: the number of items the view names (approval_set: its items; replies_ready: its count; else 1). The render output is `JSON.stringify({ v: 1, kind, count, itemId, lang })`; the sender adds `id`.
- **Test (unit, `registry.test.ts`):**
  1. Exactly `pushKinds` have a push renderer; every other kind → `{ ok: false }` for push.
  2. For the fixture of every push kind: the parsed output has exactly the keys `v, kind, count, itemId, lang`, and its JSON holds no string of the view other than the item id (planted strings `CANARYSUBJ`, `CANARYFROM`, `CANARYBODY` in every string field the schema allows).
  3. `approval_set` with 3 items → `count` 3; `approval` → `itemId` = its action id.

## Step 2 — The push sender job

- **Goal:** `channels.push` (`createPushSender`, every 15 s) sends `channel = 'push'` rows; registered in `main.ts` when `pushConfigOf` is not null, with or without the Telegram bot.
- **Order per claimed row (D10):** age > 24 h → `failed` / `expired`; flag `web_push` off → wait 15 min, no attempt; org `suspended` → `failed` / `outdated`; quiet gate of the member (rule 3a; push kinds are all held) → hold, no attempt; per-user limit 3 per run; device: `listLiveDevices` has it? no → delete the device if its session is gone or expired, row `failed` / `no_device`; render (`bad_view` on failure); payload + `id` = row id; `sendWebPush` with `ttl` 86,400, `urgency` (D5), `topic`.
- **Results:** `sent` → row `sent` (`text` = the payload JSON, `buttons` `[]`) and `markPushSuccess`, one transaction. `gone` → delete the device (its rows go by cascade) and log `push_device_gone`. `retry` → `next_attempt_at` per D10, attempt counted, `too_many_errors` at 5. `refused` → row `failed` / `push_refused`, `markPushError("http_<status>")`.
- **Add** `no_device` and `push_refused` to `outboxFailCodes`. Log events `push_sent`, `push_device_gone`, `push_failed` with `push_subscription_id`, `kind`, `http_status`; add field names to the log allow-list.
- **Test (integration, fake fetch):**
  1. A pending urgent push row, device live → one POST; row `sent`; `last_success_at` set.
  2. Fake answers 410 → device deleted, row gone; the member's Telegram row untouched.
  3. 503 three times → `attempts` 3, `next_attempt_at` 30 s, 60 s, 120 s after each; 5th failure → `failed` / `too_many_errors`.
  4. 429 `Retry-After: 30` → `next_attempt_at` = now + 30 s.
  5. Quiet hours 22:00–07:00 at 23:00 (fixed clock, org zone) → held to 07:00, no POST.
  6. Session expired → no POST, device deleted, row `failed` / `no_device`.
  7. Row 25 h old → `expired`, no POST.
  8. Flag off → no POST, row waits 15 min.
  9. Four rows of one user → three POSTs this run.
  10. Crash simulation: a row left `sending` with `locked_at` 6 min ago → sent again once (warn `outbox_push_resent_after_stale`).
  11. Log canary: planted endpoint and keys never in any log line of the run.
- **Mutation guard:** remove the quiet gate, the live-session check and the flag check in turn; see a test fail; list them.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** Telegram detail (09–12).
