# s2-telegram — Stage 11

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 11 — Outbox sender [risky]

- [x] **11.1 `createOutboxSender`: send due rows with the quiet hours, limits and error rules**
  - Goal: every due outbox row goes to its member's chat once (D4: at least once, a duplicate only after a crash or a lost answer), never in quiet hours for notices (P4), with the Telegram limits and error kinds of D14.
  - Files: create `apps/server/src/modules/channels/sender.ts`, `apps/server/test/integration/channels-sender.test.ts`; change `apps/server/src/modules/channels/index.ts`, `apps/server/src/modules/channels/fake/channel.ts` (an `onSend` hook).
  - Interfaces:
    - `interface SenderDeps { db: Db | Transaction<DB>; channel: ChatChannel; now(): Date; batchSize?: number; perUserLimit?: number }` (defaults 20 and 3).
    - `createOutboxSender(deps: SenderDeps): { run(): Promise<void> }`
    - Constants: `SENDER_STALE_MS = 5 * 60_000`; `OUTBOX_MAX_AGE_MS = 24 * 3_600_000`; `SOFT_BACKOFF_START_MS = 30_000`; `SOFT_BACKOFF_MAX_MS = 15 * 60_000`; `CONFIG_PAUSE_MS = 10 * 60_000`; `MAX_OTHER_ERRORS = 5`.
    - Fake channel: `onSend?: (chatId: number, message: OutMessage) => Promise<void>` runs inside `send` before it returns (tests change the DB there).
  - Decisions:
    - In-memory state of the sender: `pausedUntil: Date | null`. `run()` returns at once while `now < pausedUntil`. `backoff(n)` = `min(SOFT_BACKOFF_START_MS × 2^(n − 1), SOFT_BACKOFF_MAX_MS)`.
    - `run()`: `now = deps.now()`; `claimDueOutbox({ now, limit: batchSize, staleBefore: now − SENDER_STALE_MS })` (an error here → one `error` line with `describeError`, return). Then for each claimed row, in order (`ctx = { orgId: row.orgId }`):
      1. `wasStale` → ``log.warn(`outbox ${row.id}: sent again after a stale send (a duplicate is possible)`)``.
      2. `now − createdAt > OUTBOX_MAX_AGE_MS` → `failOutbox(expired)`, `warn`; next row.
      3. The organization timezone (`getOrganization`, cached per run). `kind !== "digest"` and `isQuietTime(now, tz)` → `releaseOutbox(next: quietEnd(now, tz), countAttempt: false)`; next row.
      4. This member already got `perUserLimit` messages in this run → `releaseOutbox(next: now, countAttempt: false)`; next row.
      5. `getChatLinkForUser(ctx, row.userId)` → none → `failOutbox(no_chat)`, `warn`; next row.
      6. `channel.send(link.chatId, { text, buttons })`. Set a local flag `sent = true` when it resolves; count the member.
      7. One transaction: `markOutboxSent(trx, ctx, id, lockedAt, { messageId, at: now })` and, for `kind` `digest`, `reports.markDigestSent(trx, ctx, digestId, now)`. `markOutboxSent` false → ``log.warn(`outbox ${id}: lost the claim after the send`)`` (only after a stale take-back). Then ``log.info(`outbox ${id}: sent ${kind}`)``.
    - Errors of one row (`catch` around steps 2–7):
      - `ChannelError` `rate_limited` → `releaseOutbox(next: now + retryAfterMs, countAttempt: false)`; release all later claimed rows of this run with the same `next` and no count; `pausedUntil = now + retryAfterMs`; one `warn` line; stop the run.
      - `soft` → `releaseOutbox(next: now + backoff(attempts + 1), countAttempt: true)`; release the later rows (`next` = the same time, no count); `pausedUntil` = that time; `` warn `outbox ${id}: ${code}; sending paused for ${s} s` ``; stop the run.
      - `config` (401) → release this row and the later rows (`next: now + CONFIG_PAUSE_MS`, no count); `pausedUntil = now + CONFIG_PAUSE_MS`; one `error` line `telegram token rejected (401): check TELEGRAM_BOT_TOKEN; sending paused for 10 min`; stop the run.
      - `blocked` (403) → `failOutbox(blocked)`, `` warn `outbox ${id}: the user blocked the bot (403)` ``; next row.
      - `bad_request` (400) → `failOutbox(bad_request)`, `` error `outbox ${id}: Telegram refused the message (${code})` ``; next row.
      - `other` → `attempts + 1 >= MAX_OTHER_ERRORS` → `failOutbox(too_many_errors)`, else `releaseOutbox(next: now + backoff(attempts + 1), countAttempt: true)`; `` error `outbox ${id}: ${code}` ``; next row.
      - Any other error (DB): `sent` is false → `releaseOutbox(next: now + backoff(attempts + 1), countAttempt: true)`; `sent` is true → do not touch the row (it stays `sending`; the next claim after 5 min sends it again: at least once); either way one `error` line with `describeError(error)` and the row id; next row.
      - A failing release or fail call is caught and logged (`describeError`); `run()` never throws.
    - Log lines hold the row id, the kind, codes and seconds only. Never the text, the buttons, the chat id or the member's name.
    - Notices made before a `/pause` still go out (the detection of stage 12 makes no new ones for a paused mailbox); accepted, rare.
  - Test (`channels-sender.test.ts`; `withRollback` + `isolateChannels(trx)`; `createFakeChannel()`; `linkChat` with `randomChatId()`; `T` = `2026-11-06T10:00:00Z` (11:00 in Warsaw); rows from `insertOutbox` with `createdAt` and `nextAttemptAt` = `T` unless said; a spy on `console.log` / `console.error` collects the log lines):
    1. One `urgent` row → one fake send to the member's chat with the row's text and buttons; the row is `sent` with `external_message_id` 1000; no log line contains the text.
    2. One `digest` row with its `digests` row → sent; `digests.sent_at` = `T`.
    3. Quiet hours: a run at `2026-11-06T21:30Z` (22:30) → the `urgent` row is `pending` with `next_attempt_at` = `2026-11-07T06:00:00Z` and `attempts` 0, no send; a `digest` row in the same run → sent.
    4. `rate_limited` (7000 ms) on the first of 3 rows → all 3 `pending`, `next_attempt_at` = `T + 7 s`, no send; a run at `T + 1 s` claims nothing; a run at `T + 8 s` sends all 3.
    5. `soft` → `pending`, `attempts` 1, next = `T + 30 s`; a run at `T + 31 s` with another soft error → `attempts` 2, next = `T + 91 s`.
    6. `config` → nothing is sent in a run at `T + 5 min`; exactly one `error` line with `401` over both runs; a run at `T + 11 min` sends.
    7. `blocked` on the first of 2 rows → the first is `failed` / `blocked`; the second is sent in the same run.
    8. `bad_request` → `failed` / `bad_request`.
    9. `other` with `attempts` already 4 → `failed` / `too_many_errors`; with `attempts` 0 → `pending`, `attempts` 1.
    10. A row with `createdAt` = `T − 25 h` → `failed` / `expired`, no send.
    11. A row of a member without a chat link → `failed` / `no_chat`.
    12. 5 due rows of one member → 3 sent in the first run, 2 `pending` with `attempts` 0; the next run sends them.
    13. A `sending` row with `locked_at` = `T − 6 min` → sent, and one `warn` line with `sent again after a stale send`.
    14. Rows of two organizations → each goes to its own member's chat.
    15. `onSend` changes the row's `locked_at` in the DB (a stale take-back in the middle) → after the send, `warn` `lost the claim after the send`; the run goes on; no exception.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: making the rows (stages 12, 13), the schedule wiring (stage 20).
