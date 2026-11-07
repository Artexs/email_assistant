# s2-telegram — Stage 14

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 14 — Update router [risky]

- [x] **14.1 `createTelegramBot`: private chats only, `/start` linking, linked chats only, commands and buttons to handlers**
  - Goal: every update first passes the chat checks (D2, D3); only `/start <token>` works in an unlinked chat; every other update of a linked chat goes to a channel-neutral handler with the member's `LinkedChat` (the tenant comes from the link, never from the update).
  - Files: create `apps/server/src/modules/channels/telegram/bot.ts`, `apps/server/src/modules/channels/texts.ts`, `apps/server/src/modules/channels/texts.test.ts`, `apps/server/test/integration/telegram-helpers.ts`, `apps/server/test/integration/telegram-router.test.ts`; change `apps/server/src/modules/channels/port.ts`, `apps/server/src/modules/channels/index.ts`.
  - Interfaces:
    - `port.ts`: `const commandNames = ["help", "digest", "status", "pause", "resume"] as const`; `type CommandName`; `interface CallbackResult { answer: string; edit?: OutMessage; send?: OutMessage }`; `interface UpdateHandlers { command(link: LinkedChat, name: CommandName): Promise<OutMessage>; callback(link: LinkedChat, data: string): Promise<CallbackResult> }`.
    - `telegram/bot.ts`: `interface BotDeps { db: Db | Transaction<DB>; now(): Date; handlers: UpdateHandlers }`; `createTelegramBot(token: string, deps: BotDeps, opts?: { botInfo?: UserFromGetMe; apiRoot?: string }): Bot`.
    - `texts.ts` (pure): `helpText(): string`; `const LINKED_TEXT`, `LINK_USED_TEXT`, `LINK_EXPIRED_TEXT`, `ERROR_TEXT`.
    - `telegram-helpers.ts` (tests): `testBotInfo` (a full `UserFromGetMe` object, all required fields of `grammy/types`); `recordCalls(bot): { calls: { method: string; payload: Record<string, unknown> }[] }` (installs an API transformer that records and answers `sendMessage` with a message object, everything else with `true`); `messageUpdate({ updateId, chatId, text, chatType?: "private" | "group" | "supergroup", fromIsBot?: boolean }): Update` (adds a `bot_command` entity when the text starts with `/`); `callbackUpdate({ updateId, chatId, data, messageId }): Update`.
  - Decisions:
    - Middleware order in `createTelegramBot` (`new Bot(token, { botInfo, client: apiRoot ? { apiRoot } : undefined })`):
      1. Chat guard: no `ctx.chat`, `ctx.chat.type !== "private"`, `ctx.chat.id <= 0`, or `ctx.from?.is_bot` → return without `next()` (no reply, no API call). For a button tap, `ctx.chat` is the chat of the message with the button; a tap without a message (inline mode) has no chat → ignored.
      2. `bot.command("start", …)`: `payload = ctx.match.trim()`. A payload → `consumeLinkToken(db, { token: payload, chatId: ctx.chat.id, now })`: `linked` → reply `LINKED_TEXT` and ``log.info(`chat linked for user ${userId} in org ${orgId}`)``; `used` → reply `LINK_USED_TEXT`, `log.info("a used link token was tried")`; `expired` → reply `LINK_EXPIRED_TEXT`, `log.info("an expired link token was tried")`; `unknown` → if `findChatLink(chat.id)` exists → reply `helpText()`, else no reply (`log.debug("ignored /start with an unknown token")`). No payload → linked chat → `helpText()`; unlinked → no reply.
      3. Link guard: `link = findChatLink(db, ctx.chat.id)`; none → `log.debug("ignored an update from an unlinked chat")`, return. Else keep the link for this update (a `WeakMap<Context, LinkedChat>`) and call `next()`.
      4. One `bot.command(name, …)` per name in `commandNames`: `message = await handlers.command(link, name)`; `ctx.reply(message.text, messageOptions(message.buttons, { clearKeyboard: false }))`.
      5. `bot.on("callback_query:data", …)`: ``try { result = await handlers.callback(link, ctx.callbackQuery.data) } catch (error) { log.error(`callback failed: ${telegramErrorLabel(error)}`); result = { answer: ERROR_TEXT } }``; then `ctx.answerCallbackQuery({ text: cutText(result.answer, 200) })` in its own `try` / `catch` (an error, for example a tap that is too old, → `warn` with `telegramErrorLabel`; the feedback row is already written); then `result.edit` → `ctx.editMessageText(text, messageOptions(buttons, { clearKeyboard: true }))` (a `GrammyError` 400 with "message is not modified" → ignore; any other error → `warn` with `telegramErrorLabel`); then `result.send` → `ctx.reply(…)`.
      6. `bot.on("message", …)`: any other message of a linked chat (plain text, an unknown command, a sticker) → reply `helpText()`.
      7. ``bot.catch((err) => log.error(`update ${err.ctx.update.update_id} failed: ${telegramErrorLabel(err.error)}`))`` (without it grammY stops polling on the first error, fact list).
    - Every reply and edit uses `messageOptions` (stage 5): plain text, no link preview.
    - Texts (exact):
      - `helpText()`: `Commands:` / `/digest – the digest now` / `/status – mailboxes, last sync, LLM calls` / `/pause – stop reading and triage of your mailboxes` / `/resume – start them again` / `/help – this list` / `Tap ✅ when the AI category is right, ✏️ to correct it.` (lines joined with `\n`).
      - `LINKED_TEXT`: `✅ This chat is linked. Digests and urgent notices come here.` + `\n` + `helpText()`.
      - `LINK_USED_TEXT`: `This link was used already. Ask for a new link.`
      - `LINK_EXPIRED_TEXT`: `This link has expired (a link works for 15 minutes). Ask for a new link.`
      - `ERROR_TEXT`: `Something went wrong. Try again later.`
    - Log lines hold user and org ids only; never the chat id, the text, the payload or the button data.
  - Test (`telegram-router.test.ts`; `withRollback`; `createTelegramBot(TOKEN, { db: trx, now: () => T, handlers: fake }, { botInfo: testBotInfo })` with `recordCalls`; `fake` records its calls and returns set results; chat ids from `randomChatId()`; `bot.handleUpdate(update)` for each case):
    1. Unlinked private chat: `hello`, `/status`, `/help`, `/start`, `/start <well-formed unknown token>`, `/start short`, and a button tap `fe:<uuid>` → zero recorded API calls; the fake handlers were never called.
    2. A `group` and a `supergroup` update with `/status` (negative chat ids), and a message with `from.is_bot: true` in a linked private chat → zero calls.
    3. `/start <token from createLinkToken>` in a new private chat → one `sendMessage` with `LINKED_TEXT`, `link_preview_options.is_disabled` true, no `parse_mode`; a `chat_links` row for that chat.
    4. The same token from another chat → one `sendMessage` with `LINK_USED_TEXT`; no new link row.
    5. A token at `T` after its expiry → `LINK_EXPIRED_TEXT`.
    6. Linked chat: `/status` → the fake got `(link, "status")` with the right `orgId`, `userId` and role, and one `sendMessage` with the fake's text and keyboard; `/start` without a payload, `hello` and `/foo` → `helpText()`.
    7. Linked chat, button tap → `answerCallbackQuery` with the fake's answer; `edit` → `editMessageText` with the tapped message id and `reply_markup` `{ inline_keyboard: [] }`; `send` → `sendMessage`.
    8. The fake callback throws `new Error("MARKER-ERR")` → `answerCallbackQuery` with `ERROR_TEXT`; one `error` line without `MARKER-ERR`.
    9. A chat linked to an org B member → the fake gets `orgId` B.
    10. No log line contains `TOKEN`, a chat id, a message text or a button data value (spy on `console`).
    - `texts.test.ts`: `helpText()` names all five commands; `LINKED_TEXT` starts with `✅`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: polling and `setMyCommands` (stage 15), the real handlers (stages 16–18).
