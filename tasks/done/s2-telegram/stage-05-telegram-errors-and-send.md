# s2-telegram — Stage 5

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 5 — Telegram adapter: error labels and send [risky]

- [x] **5.1 `ChatChannel` port, the Telegram adapter, error kinds, the fake channel**
  - Goal: one channel-neutral send and edit (ADR 0005 `ChatChannel` port) with log-safe error kinds; the bot token and the message text never reach a log line or an error message (D1, D8).
  - Files: create `apps/server/src/modules/channels/port.ts`, `apps/server/src/modules/channels/telegram/api.ts`, `apps/server/src/modules/channels/telegram/api.test.ts`, `apps/server/src/modules/channels/fake/channel.ts`; change `apps/server/src/modules/channels/telegram/errors.ts`, `apps/server/src/modules/channels/index.ts`.
  - Interfaces:
    - `port.ts` (no grammY import):
      - `type ChannelErrorKind = "soft" | "rate_limited" | "config" | "blocked" | "bad_request" | "other"`
      - `class ChannelError extends Error { constructor(readonly kind: ChannelErrorKind, readonly code: string, readonly retryAfterMs: number | null = null) }` — `message` = `` `channel error ${code}` ``, `name` = `"ChannelError"`. `code` is log-safe: `telegram_<HTTP-like code>`, `telegram_network`, `telegram_unknown`, `message_too_long`, `button_data_too_long`.
      - `interface ChatChannel { send(chatId: number, message: OutMessage): Promise<{ messageId: number }>; edit(chatId: number, messageId: number, message: OutMessage): Promise<void> }`
    - `telegram/errors.ts` adds `toChannelError(error: unknown): ChannelError`.
    - `telegram/api.ts`:
      - `createTelegramApi(token: string, opts?: { apiRoot?: string }): Api` (grammY `Api`; `main.ts` gets the bot's own `bot.api` in stage 20, tests and scripts may use this).
      - `messageOptions(buttons: OutButton[][], opts: { clearKeyboard: boolean }): { link_preview_options: { is_disabled: true }; reply_markup?: InlineKeyboardMarkup }` — exported for the router (stage 14).
      - `createTelegramChannel(api: Api): ChatChannel`
    - `fake/channel.ts`: `interface FakeChannel extends ChatChannel { sent: { chatId: number; message: OutMessage; messageId: number }[]; edited: { chatId: number; messageId: number; message: OutMessage }[]; failWith(error: ChannelError | null, times?: number): void }` and `createFakeChannel(): FakeChannel` (message ids count up from 1000; `failWith(e, n)` makes the next `n` calls throw `e`, default `n` = every call until `failWith(null)`).
    - `channels/index.ts` exports `ChatChannel`, `ChannelError`, `ChannelErrorKind` (types and class) and `createTelegramChannel`, `createTelegramApi`.
  - Decisions:
    - `toChannelError`: `GrammyError` → by `error_code`: 429 → `rate_limited`, `retryAfterMs` = `(error.parameters.retry_after ?? 30) * 1000`; 401 → `config`; 403 → `blocked`; 400 → `bad_request`; ≥ 500 → `soft`; any other → `other`; `code` = `` `telegram_${error_code}` ``. `HttpError` (network error or timeout) → `soft`, `telegram_network`. Anything else → `other`, `telegram_unknown` (also an error that an API transformer throws: grammY passes it on as it is, probe 2026-11-05). Never copy `message`, `description`, `payload` or `error.error` into the `ChannelError`.
    - `send`: first the guards, before any API call: `message.text.length` 1–4096, else `ChannelError("bad_request", "message_too_long")`; every button data 1–64 bytes (`Buffer.byteLength`), else `ChannelError("bad_request", "button_data_too_long")`. Then `api.sendMessage(chatId, text, messageOptions(buttons, { clearKeyboard: false }))`; return `{ messageId: result.message_id }`. No `parse_mode` key at all (D1). Empty `buttons` → no `reply_markup` key.
    - `edit`: the same guards; `api.editMessageText(chatId, messageId, text, messageOptions(buttons, { clearKeyboard: true }))`: empty `buttons` → `reply_markup: { inline_keyboard: [] }` (removes the old keyboard). A `GrammyError` 400 whose `description` contains `message is not modified` counts as success [not verified: the exact text]; read the description only for this check, never log it.
    - `messageOptions` maps `OutButton` to `{ text, callback_data: data }`.
    - All errors leave `send` and `edit` as `ChannelError` (catch, then `throw toChannelError(error)`).
  - Test (`api.test.ts`, unit; `createTelegramApi(TOKEN)` with `api.config.use(transformer)` that records `{ method, payload }` and returns a set answer; `TOKEN` = `123456:MARKERTOKENaaaaaaaaaaaaaaaaaaaaaaaaaa`; text marker `MAILTEXT-MARKER`):
    1. `send(42, { text: "hi", buttons: [[{ text: "✅ 1", data: "fe:<uuid>" }]] })` → one `sendMessage` call with `chat_id` 42, `text` "hi", `link_preview_options` `{ is_disabled: true }`, `reply_markup` `{ inline_keyboard: [[{ text: "✅ 1", callback_data: "fe:<uuid>" }]] }`, no `parse_mode` key; returns `{ messageId: 77 }`.
    2. `send` with `buttons: []` → the payload has no `reply_markup` key.
    3. `edit(42, 5, { text: "x", buttons: [] })` → `editMessageText` with `reply_markup` `{ inline_keyboard: [] }`.
    4. Error kinds from `{ ok: false, error_code, description, parameters }` answers: 429 with `retry_after` 7 → `rate_limited`, 7000; 429 without parameters → 30000; 401 → `config`; 403 → `blocked`; 400 → `bad_request`; 502 → `soft`; 409 → `other`.
    5. `edit` with 400 `"Bad Request: message is not modified: specified new message content…"` → resolves.
    6. The transformer throws `new Error("boom MARKERTOKEN")` → `other` / `telegram_unknown`; neither `err.message` nor `describeError(err)` contains `MARKERTOKEN`.
    7. A real network error: `createTelegramApi(TOKEN, { apiRoot: <closed port> })` without a transformer → `soft`; `err.message` and `telegramErrorLabel(err)` do not contain `MARKERTOKEN`.
    8. A 400 answer to a `sendMessage` whose text holds `MAILTEXT-MARKER` → `err.message`, `describeError(err)` and `String(err)` do not contain `MAILTEXT-MARKER`.
    9. A text of 4097 characters → `message_too_long` and no API call; a button data of 65 bytes → `button_data_too_long` and no API call.
    10. `createFakeChannel()`: `send` records and returns 1000, 1001; `failWith(new ChannelError("soft", "telegram_network"), 1)` fails once, then works.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: what the sender does with each kind (stage 11); polling (stage 15); command replies (stage 14 uses `messageOptions`).
