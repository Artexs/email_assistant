# s2-telegram — Stage 15

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 15 — Polling and the bot command list

- [ ] **15.1 `startPolling`: long polling with the 401 / 409 rules, `setMyCommands`, a clean stop**
  - Goal: the server receives updates by long polling (ADR 0005, no inbound port); a wrong token stops polling with one clear line; a second consumer of the same token (409) shows up in the log and does not end in a tight loop (D9).
  - Files: create `apps/server/src/modules/channels/telegram/polling.ts`, `apps/server/src/modules/channels/telegram/polling.test.ts`; change `apps/server/src/modules/channels/index.ts`.
  - Interfaces:
    - `const BOT_COMMANDS: readonly { command: CommandName; description: string }[]` = `digest` "The digest now", `status` "Mailboxes, last sync, LLM calls", `pause` "Stop reading and triage", `resume` "Start reading and triage again", `help` "The command list".
    - `interface PollingDeps { sleep?(ms: number, signal: AbortSignal): Promise<void> }` (default: a timer that ends early when the signal aborts).
    - `interface Polling { stop(): Promise<void>; done: Promise<void> }`
    - `startPolling(bot: Bot, deps?: PollingDeps): Polling`
  - Decisions (grammY facts in the task file):
    - Loop until stopped: `await bot.start({ allowed_updates: ["message", "callback_query"], onStart })`. `onStart(info)`: ``log.info(`telegram: polling as @${info.username} (id ${info.id})`)``, then `bot.api.setMyCommands(BOT_COMMANDS)` (an error → `` warn `telegram: setMyCommands failed: ${telegramErrorLabel(error)}` ``, polling goes on), and reset the retry count. `drop_pending_updates` stays off: taps made while the server was down (Telegram keeps updates up to 24 h) are handled after the start.
    - `bot.start()` resolves (stopped) → the loop ends.
    - `bot.start()` rejects (not stopping):
      - `GrammyError` 401 → `log.error("telegram: the bot token was rejected (401): check TELEGRAM_BOT_TOKEN; polling stopped")`; the loop ends (no retry: a wrong token stays wrong).
      - `GrammyError` 409 → retry count + 1; `delay = min(60 s × 2^(count − 1), 30 min)`; ``log.error(`telegram: another process polls this bot token (409); dev and pilot must use different bots (ADR 0005); next try in ${minutes} min`)``; wait `delay` (ends early on stop); start again.
      - anything else → the same retry count and delay; ``log.error(`telegram: polling failed: ${telegramErrorLabel(error)}; next try in ${minutes} min`)``.
    - `stop()`: set the stop flag; abort the wait; if `bot.isRunning()`, `await bot.stop()` and catch its error (`warn` with `telegramErrorLabel`: it rejects when the API cannot be reached, fact list); then `await done`. `bot.stop()` aborts the long poll and confirms the last update.
    - Updates are handled one by one (grammY default); handlers are short DB work and one API call.
    - No log line holds the token (only the bot user name and id, which are not secret).
  - Test (`polling.test.ts`, unit; a fake Bot API with `Bun.serve({ port: 0 })` that answers per method and records the paths; `new Bot(TOKEN, { client: { apiRoot } })` with a `bot.catch`; a spy on `console`):
    1. Normal: `getMe`, `deleteWebhook`, `getUpdates` (empty after 50 ms) → one `info` line `polling as @probe_bot`; `setMyCommands` got the 5 commands; `stop()` resolves; `done` resolves; the last `getUpdates` was the confirm call.
    2. `getUpdates` answers 409 twice: the fake `sleep` records 60 000 and then 120 000 ms; two `error` lines with `409`; then `stop()` ends the loop.
    3. `getMe` answers 401 → one `error` line with `rejected (401)`; `done` resolves without any `sleep` call.
    4. `setMyCommands` answers 400 → one `warn` line; `getUpdates` is still called.
    5. With the default `sleep`: after a 409, `stop()` makes `done` resolve within 1 s.
    6. No log line contains `TOKEN`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: the server wiring and the shutdown order (stage 20), webhooks (only with a public HTTPS address, not in S2).
