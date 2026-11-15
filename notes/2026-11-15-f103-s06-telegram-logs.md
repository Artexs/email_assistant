# F103 stage 06: Telegram log lines (notes for later stages and reviewers)

## Facts found while building

- grammY 1.46 `bot.start` retries a network error (`HttpError`), a 5xx and a 429 inside `init` and the polling loop. Only 401, 409, a 4xx such as 404, and a non-Telegram error leave it. So `telegram_polling_failed` fires only for those. `polling.test.ts` reaches it with a `getMe` 404 and with a plain `Error` thrown by an API transformer.
- `bot.stop()` after a network failure rejects with an `HttpError`: `telegram_stop_failed` then carries `error` `HttpError`, `method` `getUpdates`.
- `bot.handleUpdate` rejects with a `BotError` when a handler throws; only the polling loop calls `bot.errorHandler`. Tests call `await bot.errorHandler(failure)` the same way.
- `update_failed` runs outside the update context: it has `update_id` and no `job`, no `run_id`.

## Not in stage 06 (stage 07 owns it): other places that log a Telegram error or text in old form

- `apps/server/src/modules/channels/routes.ts:52`: `log.warn(\`web: telegram getMe failed: ${telegramErrorLabel(error)}\`)` (Telegram error; use `...telegramErrorFields(error)`).
- `routes.ts:66`, `commands.ts:352,359`, `approval-taps.ts:83`, `digest-job.ts`, `notices/*`: old-form lines without a Telegram error.
- `apps/server/src/scripts/telegram-check.ts`, `telegram-link.ts` print `telegramErrorLabel` through `createCliOutput` (stage 03/04, D4: allowed). `telegramErrorLabel` stays exported.

## Mutation checks (each run alone; logs in /tmp/f103-s06/mut/, sources restored)

`telegramErrorFields(x)` replaced by `{ error: x.message }` at each site: bot.ts sites 1-6 (command_failed, command_reply_failed, callback_failed, callback_answer_failed, message_edit_failed, update_failed) fail 10, 8, 12, 10, 6, 8 tests; polling.ts sites 1-3 (set_commands, polling_failed, stop_failed) fail 1, 2, 1 tests.
Other guards: context middleware removed (26 fail); fixed `run_id` (2 fail, the two-updates test); `job` removed (25 fail); `isNotModified` guard removed (2 fail); `update_id` removed (8 fail); `user_id` removed from `chat_linked` (2 fail); `wait_ms` in minutes in the 409 line (1 fail); `wait_ms` removed from `telegram_polling_failed` (2 fail); description added to the 409 line (1 fail); `bot_id` removed (1 fail); telegram path removed from the lint `error` block (log-lint test fails).
