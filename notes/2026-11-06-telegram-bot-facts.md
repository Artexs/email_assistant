# Telegram bot facts (S2)

Verified Telegram Bot API and grammY facts for S2. Task: `tasks/active/s2-telegram.md`. Alert texts: `docs/known-alerts.md`.
Each fact has its source and date. "Pending (stage 21/23)" means that the live run has not yet shown it.

## Facts checked on 2026-11-05 (planning, no real token)

grammY (latest version 1.46.0, npm, 2026-08-26). Source read in `grammyjs/grammY` main (`src/bot.ts`, `src/core/client.ts`, `src/core/error.ts`):

- The polling loop rethrows 401 and 409, so `bot.start()` rejects. It sleeps `retry_after` on 429 and 3 s on other errors.
- Updates are handled one by one. Without `bot.catch`, grammY prints the error and stops the bot.
- `bot.stop()` aborts the long poll and confirms the offset with one more `getUpdates` call.
- `sensitiveLogs` is `false` by default, so `HttpError.message` has no URL.

Local probe on the Mac (grammY 1.46.0, Bun 1.4.4, a fake Bot API server on 127.0.0.1, no real token):

- The node build of grammY runs under Bun (fetch shim `node-fetch`).
- A network error gives `HttpError` with the message "Network request for 'getMe' failed!". Its inner `.error` (a `TypeError`, code `ECONNREFUSED`) **holds the URL with the token**. `String(error)` and `error.stack` do not. This is why the code logs only `telegramErrorLabel(error)` (D8).
- A `GrammyError` keeps the request `payload`, which holds the message text. Never log it.
- 409 and 401 make `bot.start()` reject. `start()` works again after that. `bot.stop()` rejects with `HttpError` when the API is down.
- Tests work with `new Bot(token, { botInfo })`, `bot.api.config.use(transformer)` and `bot.handleUpdate(update)`: no network. `ctx.reply` and `ctx.answerCallbackQuery` go through the transformer.
- `/start abc_DEF-123` gives `ctx.match = "abc_DEF-123"`.
- An error that an API transformer throws is not wrapped: it comes out as it is (not `HttpError`).
- `editMessageText` with the same content gives `GrammyError` 400 whose description contains "message is not modified" (text of the fake server; the real text is pending, stage 21).

Telegram Bot API pages (core.telegram.org/bots/api, read 2026-11-05):

- `sendMessage` text: 1–4096 characters after entity parsing. `parse_mode` is optional. `link_preview_options.is_disabled` turns the preview off.
- `callback_data`: 1–64 bytes. `answerCallbackQuery` text: 0–200 characters.
- `getUpdates` confirms an update with a higher offset. Telegram keeps updates at most 24 hours.
- A chat id has at most 52 significant bits (safe in `bigint` and a JS number).
- `retry_after` is the number of seconds to wait.
- `editMessageText` has a 48-hour limit only for business messages.
- Entity offsets count UTF-16 code units.
- Deep links (bots/features): `t.me/<bot>?start=<payload>`; the payload has up to 64 characters of `A-Z a-z 0-9 _ -`; the bot gets `/start <payload>`.
- Bots FAQ: about 1 message per second per chat, about 30 per second in total (this is why the sender sends at most 3 messages per user per 15-second tick).

node-postgres on the dev DB (2026-11-05): `time[]` comes back as `["08:00:00","16:00:00"]` (strings with seconds). `bigint` comes back as a string.

## Facts from the build (2026-11-06)

- `bot.handleUpdate` rethrows an update error as `BotError`. `bot.catch` runs only inside `bot.start`. The router test helpers catch the error themselves (stage 14).
- `onStart` of `bot.start` fires after `getMe` and before the first `getUpdates`. So a 409 would reset the retry count at each try. The code resets the count only after a good `getUpdates` (an API transformer in `polling.ts`, stage 15).
- Rows inserted in one transaction share `created_at`. Tests must not rely on the outbox insert order: find rows by `dedup_key` (stage 12).
- The bot token format is `<digits>:<35 characters>`. The config check is loose: `^\d+:[A-Za-z0-9_-]{20,}$`.
- Step 0.1 (2026-11-06): dev bot `@Email_assistant_local_bot` (id 9088924109) passes `bun run telegram:check`. The pilot bot is `@Email_assistant_vps_bot`. Bot user names are not secret; the tokens are.

## Accepted: the digest race at `periodEnd` (checkpoint 2, user decision 2026-11-06)

A triage result whose transaction starts before the `periodEnd` of a digest but commits after the digest read is in no digest: the next period starts after `periodEnd`.
The window is milliseconds, because the LLM call is outside the save transaction. Urgent notices are not affected: they use a 24-hour look-back with dedup (`urgent:<email id>`).
Accepted, no code change.

## Not verified when the plan was written, and what the live runs showed

| Item                                                                                               | Result                                                                                                            |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| How Telegram counts the 4096 limit (UTF-16 units or code points)                                   | The code uses JS `string.length` (UTF-16 units), never smaller. Live result: pending (stage 21)                   |
| A limit on the number of inline buttons in one message                                             | The digest uses at most 30 buttons. Live result: pending (stage 21)                                               |
| Real description texts: "message is not modified", "bot was blocked by the user", "chat not found" | The code uses the error codes; only the "not modified" case reads the description. Real texts: pending (stage 21) |
| grammY under Bun 1.3.14 (the server image; the probe used Bun 1.4.4)                               | Pending (stage 23: `telegram:check` in the image)                                                                 |
| Urgent notice time (mail arrival to message on the phone, goal ≤ 10 minutes)                       | Pending (stage 21)                                                                                                |
