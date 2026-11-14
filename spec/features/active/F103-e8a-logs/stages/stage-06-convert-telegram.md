# F103 stage 06 — Convert Telegram; a context per update

Part of [`../plan.md`](../plan.md). Review job before the land (Telegram errors can hold the bot token). Needs stage 05 landed (`telegramErrorFields`). May run next to one other conversion stage.

Two steps.

## Step 1 — A log context per update

**Goal.** Every line of one Telegram update carries `job: "telegram.update"` and one `run_id` (D10; F089 D26).

**Interface** (`modules/channels/telegram/bot.ts`, `createTelegramBot`): a new first middleware, before the chat guard (today "1. Chat guard"):

```ts
// 0. Log context: every line of one update carries job and run_id (docs/code-patterns.md § Logs).
bot.use((_ctx, next) => withLogContext({ job: "telegram.update", run_id: randomUUID() }, next));
```

- `bot.catch` runs outside that context (grammY calls it after the middleware promise rejects), so its line carries `update_id`.
- The polling loop (`polling.ts`, `bot.start`) and `onStart` stay outside any context (F089 D15).

**Decisions.** D10.

**Test** (integration, in `telegram-router.test.ts` or a new `telegram-log-context.test.ts`; `bot.handleUpdate` and the helpers of `telegram-helpers.ts`; `setLogFormat("json")`, `setLogLevel("debug")`, spies on `console.log` and `console.error`; restore all):

1. One update from an unlinked chat writes `update_unlinked_chat` with `job` `telegram.update` and a UUID `run_id`.
2. Two updates from two unlinked chats at once (`Promise.all` of two `handleUpdate`) give two `update_unlinked_chat` lines with two different `run_id` values.
3. With the fake handlers of `telegram-router.test.ts` (`makeFake`, `setup`, `linkedMember`): a linked chat sends `/status`; the fake `command` handler awaits a 10 ms timer, then rejects. The link guard awaited a DB call before. The `command_failed` line carries `job` `telegram.update` and a UUID `run_id`.
4. A callback tap from a linked chat whose fake `callback` handler rejects, while an API transformer (`bot.api.config.use`) makes `answerCallbackQuery` fail with a `GrammyError` 400: `callback_failed` and `callback_answer_failed` carry the same `run_id`.
5. A linked chat sends `hi`; the transformer makes `sendMessage` fail with a `GrammyError` 400. The reply in `bot.on("message")` has no `try`, so `bot.handleUpdate(u)` rejects with a `BotError` (grammY 1.46.0: only the polling loop calls the error handler). Run `await bot.handleUpdate(u).catch((error) => bot.errorHandler(error))` (`errorHandler` is public). The `update_failed` line has `update_id` = the update's id, `error` `GrammyError`, `error_code` 400, `method` `sendMessage`, and no `run_id`.

**Done when.** The five cases pass.

## Step 2 — Convert 17 calls in `modules/channels/telegram/`

**New field names:** number `update_id`, `bot_id`.

Old text (start) → event: fields. Levels stay.

- `chat linked for user … in org …` → `chat_linked`: `user_id`, `org_id`
- `a used link token was tried` → `link_token_used`: —
- `an expired link token was tried` → `link_token_expired`: —
- `ignored /start with an unknown token` → `link_token_unknown`: —
- `ignored an update from an unlinked chat` → `update_unlinked_chat`: —
- `command failed:` → `command_failed`: `...telegramErrorFields`
- `replying to a command failed:` → `command_reply_failed`: `...telegramErrorFields`
- `callback failed:` → `callback_failed`: `...telegramErrorFields`
- `answering a button tap failed:` → `callback_answer_failed`: `...telegramErrorFields`
- `editing a message failed:` → `message_edit_failed`: `...telegramErrorFields`
- `update ${id} failed:` → `update_failed`: `update_id`, `...telegramErrorFields(err.error)`
- `telegram: polling as @… (id …)` → `telegram_polling_started`: `bot_id` (the `@` name is not logged)
- `telegram: setMyCommands failed:` → `telegram_set_commands_failed`: `...telegramErrorFields`
- `the bot token was rejected (401) … polling stopped` → `telegram_polling_token_rejected`: —
- `another process polls this bot token (409)` → `telegram_polling_conflict`: `wait_ms`
- `telegram: polling failed: … next try in` → `telegram_polling_failed`: `...telegramErrorFields`, `wait_ms`
- `telegram: stopping the bot failed:` → `telegram_stop_failed`: `...telegramErrorFields`

- `wait_ms` in milliseconds (the old text printed minutes). Levels stay.
- `telegramErrorLabel` stays exported (scripts use it).
- Lint: add `"apps/server/src/modules/channels/telegram/**/*.ts"` to the `error` block; `log-lint.test.ts`: an old-form line at `modules/channels/telegram/__log-fixture.ts` gives `[2]`.
- Docs by D17. Known quotes: the `known-alerts.md` entry whose source is `telegram/bot.ts`; `deploy/README.md` § Telegram (`another process polls this bot token` → `telegram_polling_conflict`).

**Decisions.** D2, D5, D7, D16, D17.

**Test.**

1. Tests that matched an old text match the event text (at least `polling.test.ts`, `telegram-logs.test.ts`, `telegram-router.test.ts`).
2. `telegram-logs.test.ts` still passes: no line holds the token, the chat id, mail text or a summary.
3. `polling.test.ts`: a 409 response writes `telegram_polling_conflict` with `wait_ms` and no text of the Telegram description.

**Done when.** No `no-restricted-syntax` message in `channels/telegram/`; the tests pass; the Proof (`/tmp/f103-s06`) prints `PROOF_OK`; the final message gives the warning count, new field names and calls not in the table.

**Out of scope.** `telegram/api.ts`, `check.ts`, `runtime.ts` behaviour.
