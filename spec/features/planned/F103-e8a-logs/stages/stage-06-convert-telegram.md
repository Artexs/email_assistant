# F103 stage 06 — Convert Telegram; a context per update

Part of [`../plan.md`](../plan.md). Review job before the land (Telegram errors can hold the bot token). Needs stage 05 landed (`telegramErrorFields`).

Two steps.

## Step 1 — A log context per update

**Goal.** Every line of one Telegram update carries `job: "telegram.update"` and one `run_id` (D10; F089 D26).

**Files.** `apps/server/src/modules/channels/telegram/bot.ts`, `apps/server/test/integration/telegram-router.test.ts` or a new `apps/server/test/integration/telegram-log-context.test.ts`.

**Interfaces.**

- In `createTelegramBot`, before the chat guard (today "1. Chat guard"), add the first middleware:

  ```ts
  // 0. Log context: every line of one update carries job and run_id (docs/code-patterns.md § Logs).
  bot.use((_ctx, next) => withLogContext({ job: "telegram.update", run_id: randomUUID() }, next));
  ```

  `randomUUID` from `node:crypto`, `withLogContext` from `platform/log`.

- `bot.catch` runs outside that context (grammY calls it after the middleware promise rejects), so its line carries `update_id` (D10).
- The polling loop (`polling.ts`, `bot.start`) and `onStart` stay outside any context.

**Decisions.** D10. F089 D15 (a long-lived timer or loop is made outside any context).

**Test** (integration, with `bot.handleUpdate` and the helpers of `telegram-helpers.ts`, `LOG_FORMAT` json through `setLogFormat("json")`, spies on `console.log` and `console.error`, `setLogLevel("debug")`; restore all in `afterEach`):

1. One update from an unlinked chat writes `update_unlinked_chat` with `job` `telegram.update` and a `run_id` that is a UUID.
2. Two updates handled at once (`Promise.all` of two `handleUpdate` calls, one `/help` from a linked chat, one from an unlinked chat) give two different `run_id` values, and each line of one update has one `run_id`.
3. A command handler that awaits a DB call (the linked `/help` path) writes its lines after the `await` with the same `run_id` as its first line (proves `AsyncLocalStorage` through the grammY chain).
4. An update whose handler throws (inject the failure the way an existing test does, or a handler dependency that rejects) writes `update_failed` with `update_id` equal to the update's id and no `run_id`.

**Check.** `bun test <the test file>`.

**Done when.** The four cases pass.

## Step 2 — Convert 17 calls

**Goal.** Every log call in `modules/channels/telegram/` is an event.

**New field names** (`platform/log-fields.ts`): number `update_id`, `bot_id`.

| File:line      | Old text                                             | Level | Event                             | Fields                                                |
| -------------- | ---------------------------------------------------- | ----- | --------------------------------- | ----------------------------------------------------- |
| bot.ts:64      | `chat linked for user … in org …`                    | info  | `chat_linked`                     | `user_id`, `org_id`                                   |
| bot.ts:67      | `a used link token was tried`                        | info  | `link_token_used`                 | —                                                     |
| bot.ts:70      | `an expired link token was tried`                    | info  | `link_token_expired`              | —                                                     |
| bot.ts:75      | `ignored /start with an unknown token`               | debug | `link_token_unknown`              | —                                                     |
| bot.ts:83      | `ignored an update from an unlinked chat`            | debug | `update_unlinked_chat`            | —                                                     |
| bot.ts:105     | `command failed:`                                    | error | `command_failed`                  | `...telegramErrorFields`                              |
| bot.ts:111     | `replying to a command failed:`                      | warn  | `command_reply_failed`            | `...telegramErrorFields`                              |
| bot.ts:123     | `callback failed:`                                   | error | `callback_failed`                 | `...telegramErrorFields`                              |
| bot.ts:129     | `answering a button tap failed:`                     | warn  | `callback_answer_failed`          | `...telegramErrorFields`                              |
| bot.ts:136     | `editing a message failed:`                          | warn  | `message_edit_failed`             | `...telegramErrorFields`                              |
| bot.ts:152     | `update ${id} failed:`                               | error | `update_failed`                   | `update_id`, `...telegramErrorFields(err.error)`      |
| polling.ts:67  | `telegram: polling as @… (id …)`                     | info  | `telegram_polling_started`        | `bot_id: info.id` (the user name has `@`: not logged) |
| polling.ts:69  | `telegram: setMyCommands failed:`                    | warn  | `telegram_set_commands_failed`    | `...telegramErrorFields`                              |
| polling.ts:83  | `the bot token was rejected (401) … polling stopped` | error | `telegram_polling_token_rejected` | —                                                     |
| polling.ts:90  | `another process polls this bot token (409)`         | error | `telegram_polling_conflict`       | `wait_ms`                                             |
| polling.ts:94  | `telegram: polling failed: … next try in`            | error | `telegram_polling_failed`         | `...telegramErrorFields`, `wait_ms`                   |
| polling.ts:112 | `telegram: stopping the bot failed:`                 | warn  | `telegram_stop_failed`            | `...telegramErrorFields`                              |

- `wait_ms` is the wait in milliseconds (the old text printed minutes).
- `telegramErrorLabel` stays (CLI scripts use it); after this stage no module log line uses it. If no caller is left in `modules/`, keep the export anyway.

**Files.** `bot.ts`, `polling.ts`, `platform/log-fields.ts`, the tests that match old texts (`grep -rn "chat linked\|link token\|unlinked chat\|command failed\|button tap\|editing a message\|polling as\|setMyCommands\|polls this bot\|polling failed\|stopping the bot" apps/server/test apps/server/src --include=*.test.ts`; at least `polling.test.ts`, `telegram-logs.test.ts`, `telegram-router.test.ts`), `eslint.config.js` (add `"apps/server/src/modules/channels/telegram/**/*.ts"` to the `error` block), `log-lint.test.ts` (one case: an old-form line in `apps/server/src/modules/channels/telegram/__log-fixture.ts`, import path `"../../../platform/log"`, gives `[2]`), `docs/known-alerts.md` (D17: the `bot.ts` and `polling.ts` entries, for example the entry with "Source: `apps/server/src/modules/channels/telegram/bot.ts`").

**Decisions.** D2, D5, D7, D10, D16, D17.

**Test.**

1. The tests found by the grep match the event text.
2. `telegram-logs.test.ts` still passes: no line holds the token, the chat id, mail text or a summary.
3. New case in `polling.test.ts`: a 409 response writes `telegram_polling_conflict` with `wait_ms` and no text of the Telegram description.

**Check.** `bun test apps/server/src/modules/channels/telegram apps/server/test/integration/telegram-*.test.ts`.

**Done when.** No `no-restricted-syntax` message in `modules/channels/`; the tests pass; the Proof of `plan.md` (`/tmp/f103-s06`) prints `PROOF_OK`; the final message gives the warning count and lists new field names and calls not in the table.

**Out of scope.** `telegram/api.ts` and `runtime.ts` behaviour (no log line at `0a5c2ee`).
