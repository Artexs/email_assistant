# F118 stage 08 — Push render and sender `[risky]`

Part of [`../plan.md`](../plan.md). Needs 07. No migration.

Carry-over reads: `plan.md` D5, D9, D10; `interfaces.md`; `digest-and-notices.md` rules 3a, 3b, 7; `channels/sender.ts`, `report-mail-sender.ts` (the model), `quiet-gate.ts`, `repo.ts`; `packages/core/src/notices/`; `test/integration/log-canary.test.ts`.

## Step 1 — Facts and the push renderer (core)

- **Goal:** each push kind turns its view into `{ count, itemId }`; `renderNotice` with `channel: "push"` gives the payload JSON.
- **Files:** `packages/core/src/notices/facts.ts` (`noticeFactsOf`), the `push` entry of each push kind in `renderers.ts`; `queueNotice` adds the push check render.
- **Decisions:** `itemId`: approval, send_result → the action id; approval_set → the set id; delegation_answered → the delegation id; urgent, not_triaged → null (D17 opens the list; the email id never leaves the server); others → null. `count`: the number of items the view names (approval_set: its items; replies_ready: its count; else 1). The render output is `JSON.stringify({ v: 1, kind, count, itemId, lang })`; the sender adds `id`.
- **Test (unit, `registry.test.ts`):**
  1. Exactly `pushKinds` have a push renderer; every other kind → `{ ok: false }` for push.
  2. For the fixture of every push kind: the parsed output has exactly the keys `v, kind, count, itemId, lang`, and its JSON holds no string of the view other than the item id (planted strings `CANARYSUBJ`, `CANARYFROM`, `CANARYBODY` in every string field the schema allows).
  3. `approval_set` with 3 items → `count` 3; `approval` → `itemId` = its action id.

## Step 2 — The push sender job

- **Goal:** `channels.push` (`createPushSender`, every 15 s) sends `channel = 'push'` rows; registered in `main.ts` when `pushConfigOf` is not null, with or without the Telegram bot.
- **Order per claimed row (D10):** age > 24 h → `failed` / `expired`; flag `web_push` off → wait 15 min, no attempt; quiet gate of the member (rule 3a; push kinds are all held) → hold, no attempt; per-user limit 3 per run; device null or not live (ended or expired session) → `removeDevice` when it still exists, row `failed` / `no_device`; `loadDeviceSecret`; render (`bad_view` on failure); payload + `id` = row id; `sendWebPush` with `ttl` 86,400, `urgency` (D5), `topic`. Rows of a suspended org are not claimed (as for Telegram).
- **Results:** `sent` → row `sent` (`text` = the payload JSON, `buttons` `[]`) and `markPushSuccess`, one transaction. `gone` → this row `failed` / `no_device`, `removeDevice`, log `push_device_gone`. `retry` → `next_attempt_at` per D10, attempt counted, `too_many_errors` at 5. `refused` → row `failed` / `push_refused`, `markPushError("http_<status>")`.
- **Add** `push_refused` to `outboxFailCodes`. Log events `push_sent`, `push_device_gone`, `push_failed` with `push_subscription_id`, `kind`, `http_status`; add field names to the log allow-list.
- **Test (integration, fake fetch):**
  1. A pending urgent push row, device live → one POST; row `sent`; `last_success_at` set; the body that the fake fetch got, decrypted with the stage 01 test helper, has exactly the keys `v, id, kind, count, itemId, lang` and `id` = the row id (review T2).
  2. Fake answers 410 → device deleted, the row `failed` / `no_device` (kept), a second pending row of that device `no_device`; the member's Telegram row untouched.
  3. 503 three times → `attempts` 3, `next_attempt_at` 30 s, 60 s, 120 s after each; 5th failure → `failed` / `too_many_errors`.
  4. 429 `Retry-After: 30` → `next_attempt_at` = now + 30 s.
  5. Quiet hours 22:00–07:00 at 23:00 (fixed clock, org zone) → held to 07:00, no POST.
  6. Session expired, and (second case) session deleted by sign-out → no POST, device deleted, row `failed` / `no_device`.
  7. Row 25 h old → `expired`, no POST.
  8. Flag off → no POST, row waits 15 min.
  9. Four rows of one user → three POSTs this run.
  10. Crash simulation: a row left `sending` with `locked_at` 6 min ago → sent again once (warn `outbox_push_resent_after_stale`).
  11. Log canary: planted endpoint and keys never in any log line of the run.
- **Mutation guard:** remove the quiet gate, the live-session check and the flag check in turn; see a test fail; list them.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the dedup-key readers and the Telegram fallback (08b); Telegram detail (09–12).

## Carry-over from the stage 02 review (2026-11-18)
See `../review-2.md` (the lines for stage 08).

## First commit of this stage (carry-over from the stage 07 review, PASS c0d7fe5d)
- N1 (loop-consent bypass): when a push row ends `no_device`, plan D23 queues the Telegram row of that event. A withheld owner with a chat holds the real follow-up kind (`approval`, `send_result`) only as a push row; its Telegram row never existed. D23 would then send it to Telegram and bypass the loop-consent gate. Skip the Telegram fallback for rows with `loop_id` set, or run `splitByLoopConsent` again. Add a test.
- N2 (burst after rebind): a device whose session expired and was bound again (`rebindOnly` keeps `created_at`) gets push rows for every urgent mail of the last 24 h that arrived while it was dead. Compare `eventAt` with the later of the device `created_at` and the session `created_at` (in `planFanOut` or the sender). Add a test.
- N3 (decide, default = keep D20): a route change `urgent: telegram` to `both` writes push rows for urgent mails of the last 24 h on the next tick. Keep, and note it in the capability doc.
- N8: a 404 or 410 from the push service ends `no_device` and is excluded from the operator failed counts. Keep a separate counter or log line for it so a systematic sender bug stays visible.
- Optional tests (stage 07 survivors): M12 (`hasDevice` from live devices, not all devices), M06 (push-only members only in push-kind detectors), M26 (flag off in `queueMailboxRemovedNotices`), M28 (`countFailedOutboxSinceOfAll` excludes `no_device`), M15 (return order of ids), M14 (all rows of one event or none).
- Cost: if load matters, read the flag once per detector run (stage 07 note).
