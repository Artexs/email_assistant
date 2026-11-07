> **Status 2026-11-07 — done.** Merged into `master` (`8890d00`), CI green on `3c59bf5`. Open: the Docker image build (the daemon refuses the agent shell user); follow-ups in `tasks/planned/fake-telegram-followups.md`.

# Fake Telegram: a local Bot API emulator for agent-run dev tests

Scope: test tooling, not a roadmap slice. Needs: nothing from the user (no account, no phone, no real token).
Why not a real Telegram test account: `notes/2026-11-07-telegram-test-accounts.md` (test DC route blocked, 2026-11-07).

## Goal

A local fake of the Telegram Bot API that our server talks to in dev, plus a driver (CLI + script API) with which an agent plays the user.
The agent can then run full Telegram flows (link, notices, digest, buttons) alone, with GreenMail, and repeat them after each change.

## Scope

1. Server: answers the Bot API methods the bot uses now: `getMe`, `getUpdates` (long polling with offset), `sendMessage`, `editMessageText`, `answerCallbackQuery`, `setMyCommands` (grep `apps/server/src` for others before the plan). Keeps chats and messages in memory.
2. Realistic checks: Telegram limits and errors that our code handles (4096-character text, 64-byte `callback_data`, "message is not modified", 400/401/409/429 shapes as in `notes/2026-11-06-telegram-bot-facts.md`).
3. Driver: send a text or command as a user (`/start <code>`, `/digest`), press an inline button, read a chat (messages, buttons, edits), wait until a bot message matches a pattern. Non-interactive CLI with clear output and exit codes, and a TS API for scripts and tests.
4. App hook: a dev-only `TELEGRAM_API_ROOT` setting, passed to the bot and the `telegram:*` scripts. The code already accepts `apiRoot` (`runtime.ts`, `bot.ts`, `api.ts`, `check.ts`), today only for tests. The config refuses it outside dev (rule to be fixed by the plan).
5. One scripted end-to-end flow: link the chat → urgent notice → digest → button press → result checked in the DB and GreenMail.
6. A short doc so an agent can start and drive it.

## Placement (user decision 2026-11-07)

Separate from the application: its own workspace package (proposal: `tools/fake-telegram/`, add `tools/*` to the root `workspaces`).
The app never imports it, and it never ships in the server image. The only app change is the `TELEGRAM_API_ROOT` setting.

## Out of scope

Webhooks, media, groups, payments, other API methods; real rate limits; how messages look in the real app (the user checks that on the phone sometimes); real Telegram accounts.

## Done when

- `bun run test:unit` and `bun run test:int` pass in CI, and include the fake's own tests and the end-to-end test of scope item 5 (link → urgent notice → digest → button press → result in the DB and GreenMail).
- The server and the `telegram:check` / `telegram:link` scripts use `TELEGRAM_API_ROOT` when it is set, and the config refuses a value whose host is not loopback (`127.0.0.1`, `::1`, `localhost`).
- An agent starts the fake and the dev server, and runs the scope item 5 flow alone with the CLI (stage 6); the result is in this file.
- The server image (`deploy/Dockerfile`) builds and holds no code of `tools/`.
- `tools/fake-telegram/README.md` lets a new agent start and drive the fake without chat history.

## Plan

### Input: user decisions (2026-11-07)

- **U1 Placement.** Separate from the application (user: "make it separate from the application ... to don't make mess in the application"). New root workspace `tools/*`, first package `tools/fake-telegram/`. One reusable home for test tools (user: "have it for further usages"). The app code (`apps/*`, `packages/*`) never imports it.
- **U2 Stages.** The 6 stages below, approved by the user in chat (2026-11-07).
- **U3 Dev-only rule.** `TELEGRAM_API_ROOT` is accepted only when its host is loopback (`127.0.0.1`, `::1`, `localhost`). No new `APP_ENV` key. Reason: the config has no dev/prod setting today; a loopback root can never reach a real or remote server, and the pilot never runs the fake.
- **U4 Existing fakes.** The small ad-hoc fake Bot API servers in the unit tests (`channels/telegram/{api,check,polling}.test.ts`, `test/integration/telegram-logs.test.ts`) stay as they are. They test one call each; the new package does not replace them.
- **U5 CI.** The end-to-end test runs in CI from the start (CI already has Postgres and GreenMail services, `.github/workflows/ci.yml`).

### Facts checked (2026-11-07)

- grammY 1.46.0 `bot.start()` calls `deleteWebhook` before the first `getUpdates` (`node_modules/grammy/out/bot.js:296`, inside `withRetries`). So the fake must answer `deleteWebhook`.
- Bot API calls in the app (grep of `apps/server/src`, 2026-11-07): `getMe` (`check.ts`, and grammY `bot.init`), `sendMessage` (`api.ts:49`), `editMessageText` (`api.ts:62`, `bot.ts:133`), `answerCallbackQuery` (`bot.ts:127`), `setMyCommands` (`polling.ts:68`), `ctx.reply` = `sendMessage` (`bot.ts:42,109,141`); grammY polling: `deleteWebhook`, `getUpdates`.
- The app accepts `apiRoot` already: `createTelegramApi` (`api.ts:9`), `checkBot` (`check.ts:4`), `createTelegramBot` (`bot.ts:30`, options at `:33`; exported from `channels/index.ts`), `createTelegramRuntime` deps (`runtime.ts:25`). `main.ts:150` does not pass it; `platform/config.ts` has no `TELEGRAM_API_ROOT`; `scripts/telegram-check.ts:28` and `scripts/telegram-link.ts:63` call `checkBot(token)` without it.
- The config has no dev/prod marker (no `NODE_ENV` / `APP_ENV` in `apps/server/src`). Hence U3.
- `deploy/Dockerfile` copies a fixed list of `package.json` files, then runs `bun install --frozen-lockfile`. A new workspace changes `bun.lock`, so the Dockerfile must also copy `tools/fake-telegram/package.json` (only that file, never the code), or the image build fails.
- Root `test:unit` is `bun test packages/core apps/server/src`: it must add `tools`. `typecheck` runs `bun run --filter '*' typecheck`, so the new package needs a `typecheck` script. `lint` is `eslint .` (covers `tools/`).
- Telegram limits and error shapes: `notes/2026-11-06-telegram-bot-facts.md`.

### Parallel work with S4 (user decisions 2026-11-07)

The user allows this build to run at the same time as the S4 build (`tasks/active/s4-drafts-approvals-delegation.md`, pipeline mode, on `master`). This task uses its own worktree. Rules:

- **Git mode: worktree.** Folder `../email_assistant-wt/fake-telegram`, branch `task/fake-telegram` (steps: `tasks/README.md` § "Git mode"). All builds, checks, commits and pushes run in that folder, never in the main checkout.
- **Run mode: normal** (one stage at a time: build → review → commit → push the branch). The subagents never commit or push.
- **Stage by explicit path only.** Never `git add -A` or `git add .`.
- **Shared files.** Steps 1.1, 3.3 and 5.1 change root `package.json` (1.1 also `bun.lock`, `deploy/Dockerfile`, `eslint.config.js`). Stage 4 changes `platform/config.ts`, `config.test.ts`, `main.ts`, `channels/telegram/runtime.ts` and `.env.example`; S4 stages 16 and 18 change the same files. Before stage 4, run `git merge origin/master` in the branch, so the step builds on the newest S4 code. At the merge into `master`, keep both sides of each conflict (S4 and this task) and run all checks again.
- **Shared runtime.** The worktree uses the same dev DB, GreenMail and ports as the main checkout. Do not run `test:int`, `db:migrate` or a dev server while the S4 session runs them (ask the user if you are not sure). Stage 6.2 runs the dev server: check first that no other dev server runs (`PORT` in `.env`).
- **Merge.** After stage 6 and the user's try: `git merge origin/master` in the branch, all checks pass, then `git merge --no-ff task/fake-telegram` on `master` in the main checkout, push, and clean up (`tasks/README.md` § "Git mode").

### Rules for all stages (planner, 2026-11-07)

- **R1 Borders (U1).** No file under `apps/*` or `packages/*` imports from `tools/`. Files under `tools/fake-telegram/` may import from `apps/server/src/` and `apps/server/test/integration/` with relative paths (direction tool → app only).
- **R2 Package.** Name `@ea/fake-telegram`, folder `tools/fake-telegram/`. Source in `src/`, unit tests next to the code (`src/*.test.ts`), the end-to-end test in `test/` (stage 5).
- **R3 Test commands.** `test:unit` runs `tools/fake-telegram/src`, `test:int` runs `tools/fake-telegram/test` (stage 5). The unit run must never start the end-to-end test: CI runs `test:unit` before the DB roles exist.
- **R4 Loopback only.** The fake binds only `127.0.0.1`. It never logs or prints a token that it did not make itself (the request path holds the token: never log the path).
- **R5 Style.** The repo rules apply: TypeScript strict, `const` / `let`, template literals, no `console.log` (the CLI writes with `process.stdout.write` / `process.stderr.write` through an `io` object). The fake is not server code: it does not use `platform/log`.
- **R6 Shared constants** (stage 1, file `tools/fake-telegram/src/state.ts`, exported from `src/index.ts`; later stages use them):
  - `FAKE_TOKEN = "1000001:fake-telegram-token-local-tests-only"` (passes the config regex `^\d+:[A-Za-z0-9_-]{20,}$`; not a secret).
  - `DEFAULT_BOT = { id: 1000001, username: "fake_ea_bot", first_name: "Fake EA bot" }`.
  - `DEFAULT_CHAT_ID = 5550001` (a private chat: chat id = user id, > 0).
  - `DEFAULT_PORT = 8090` (CLI only; the TS API defaults to port 0 = a free port).

### Stage 1 — Package and core Bot API

Create `tools/fake-telegram/` (root `workspaces` adds `tools/*`, `deploy/Dockerfile` copies its `package.json`, `test:unit` adds `tools`). In-memory state (bot, chats, messages, update queue). HTTP server for `getMe`, `deleteWebhook`, `setMyCommands`, `getUpdates` (long polling with offset and timeout), `sendMessage`, `editMessageText`, `answerCallbackQuery`. Tests drive it with a real grammY `Bot`.

- [x] **1.1 Workspace, package skeleton, image**
  - Goal: an empty `@ea/fake-telegram` workspace that install, lint, typecheck, unit tests and the server image accept.
  - Files:
    - `tools/fake-telegram/package.json` (new): `{ "name": "@ea/fake-telegram", "private": true, "type": "module", "exports": { ".": "./src/index.ts" }, "scripts": { "typecheck": "tsc --noEmit" }, "devDependencies": { "grammy": "^1.46.0" } }`. No runtime dependency: the source uses only `import type` from `grammy/types`; the tests use the `grammy` runtime.
    - `tools/fake-telegram/tsconfig.json` (new): `{ "extends": "../../tsconfig.base.json", "include": ["src/**/*", "test/**/*"] }`.
    - `tools/fake-telegram/src/index.ts` (new): exports the R6 constants for now (move them to `state.ts` in 1.2 and re-export).
    - `package.json` (root): `workspaces` becomes `["apps/*", "packages/*", "tools/*"]`; `test:unit` becomes `bun test packages/core apps/server/src tools/fake-telegram/src` (R3: only `src`, not the whole `tools` folder).
    - `eslint.config.js`: add `"tools/**/*.ts"` to the `files` of `nodeConfig` (node globals, `import/order`), and add `"tools/*/tsconfig.json"` to its `import/resolver.typescript.project` list. Do not add `tools/` to the `no-restricted-imports` blocks (the grammY rule is for server code only).
    - `deploy/Dockerfile`: after `COPY packages/core/package.json packages/core/package.json` add `COPY tools/fake-telegram/package.json tools/fake-telegram/package.json`. Copy no other file of `tools/`.
    - `bun.lock`: regenerate with `bun install` (never edit by hand).
  - Interfaces: none yet.
  - Decisions: U1, R1–R3. The Dockerfile must copy the `package.json` of every workspace, else `bun install --frozen-lockfile` fails (Facts checked). The image must hold no code of `tools/`.
  - Test: none (no code yet). The checks below are the test.
  - Check: `bun install && bun run lint && bun run typecheck && bun run test:unit`; then `docker build -f deploy/Dockerfile -t ea-server-faketg-check . && docker run --rm ea-server-faketg-check ls -R /app/tools` (the output lists only `fake-telegram/package.json`). If Docker is not available on the machine, say so in the stage report; the main session runs the image check.
  - Done when: all checks pass; `git diff --stat` shows `bun.lock` changed only by the new workspace.
  - Out of scope: any fake logic; changes in `apps/*` or `packages/*`; `test:int`.

- [x] **1.2 In-memory state**
  - Goal: one pure state object that holds the bot, the chats, the messages, the callback queries and the update queue.
  - Files: `tools/fake-telegram/src/state.ts` (new), `tools/fake-telegram/src/state.test.ts` (new), `tools/fake-telegram/src/index.ts` (re-export).
  - Interfaces (stages 2, 3 and 5 build on these names):
    ```ts
    import type { Update } from "grammy/types";
    export interface FakeBotInfo {
      id: number;
      username: string;
      first_name: string;
    }
    export interface FakeButton {
      text: string;
      data: string;
    }
    export interface FakeMessage {
      chatId: number;
      messageId: number;
      from: "user" | "bot";
      text: string; // current text
      date: number; // unix seconds
      buttons: FakeButton[][]; // current inline keyboard, [] = none
      edits: string[]; // earlier texts, oldest first; edits.length = edit count
    }
    export interface FakeCallback {
      id: string;
      chatId: number;
      messageId: number;
      data: string;
      answered: boolean;
      answerText: string | null;
    }
    export interface FakeState {
      readonly bot: FakeBotInfo;
      commands: { command: string; description: string }[];
      sendAsUser(input: { chatId: number; text: string; firstName?: string }): {
        updateId: number;
        message: FakeMessage;
      };
      pressButton(input: { chatId: number; messageId: number; data: string }): {
        updateId: number;
        callback: FakeCallback;
      };
      botSend(input: { chatId: number; text: string; buttons: FakeButton[][] }): FakeMessage;
      botEdit(input: { chatId: number; messageId: number; text: string; buttons: FakeButton[][] }): FakeMessage;
      answerCallback(input: { id: string; text?: string }): FakeCallback;
      takeUpdates(input: { offset?: number; limit: number }): Update[];
      nextUpdate(signal: AbortSignal, waitMs: number): Promise<void>; // resolves on a new update, the abort or the time, whatever comes first
      messages(chatId: number): FakeMessage[]; // oldest first; [] for an unknown chat
      chatIds(): number[];
      findMessage(chatId: number, messageId: number): FakeMessage | undefined;
      findCallback(id: string): FakeCallback | undefined;
      callbacks(chatId: number): FakeCallback[]; // oldest first; [] for an unknown chat
      hasChat(chatId: number): boolean; // true after the first user message in the chat
    }
    export function createFakeState(opts?: { bot?: FakeBotInfo; now?: () => Date }): FakeState;
    ```
  - Decisions:
    - Message ids count per chat, from 1, user and bot messages share the counter (as in Telegram private chats). Update ids are global, from 1.
    - `sendAsUser` stores a user message and queues `{ update_id, message: { message_id, date, chat: { id: chatId, type: "private", first_name }, from: { id: chatId, is_bot: false, first_name }, text, entities? } }`. `first_name` defaults to `"Tester"`. When the text matches `/^\/[A-Za-z0-9_]+(@[A-Za-z0-9_]+)?/`, add `entities: [{ type: "bot_command", offset: 0, length: <match length> }]` (grammY `bot.command` needs it; `/start abc` gives `ctx.match = "abc"`).
    - `pressButton` throws `Error("no such message")` when the bot message does not exist, and `Error("no such button")` when no button of the message has that `data`. Else it stores a `FakeCallback` (id `cb-<n>`, n from 1) and queues `{ update_id, callback_query: { id, from: <user>, chat_instance: "ci-<chatId>", data, message: <the bot message as a Bot API Message, with its current text and reply_markup> } }`.
    - Bot API `Message` shape for bot messages (used here and by the server): `{ message_id, date, chat: { id, type: "private", first_name: "Tester" }, from: { id: bot.id, is_bot: true, first_name: bot.first_name, username: bot.username }, text, reply_markup? }`. `reply_markup` = `{ inline_keyboard: [[{ text, callback_data }]] }` only when `buttons` is not empty. Put this mapping in one exported function `toBotApiMessage(message: FakeMessage, bot: FakeBotInfo)`.
    - `botEdit` pushes the old text to `edits` and sets the new text and buttons. In stage 1 it throws `Error("no such message")` for an unknown message; stage 2 replaces the throws with Bot API errors.
    - `takeUpdates`: an `offset` confirms (deletes) all updates with `update_id < offset`. It then returns at most `limit` updates in id order. Without `offset`, nothing is deleted.
    - No limits, no errors of the Bot API in this step (stage 2).
  - Test: `state.test.ts`: (a) two user messages get message ids 1, 2 and update ids 1, 2; (b) `/start abc` has a `bot_command` entity of length 6, `hello` has none; (c) `takeUpdates({ offset: 2, limit: 100 })` returns only update 2, and a later `takeUpdates({ limit: 100 })` no longer returns update 1; (d) `botSend` with buttons, then `pressButton` with a known data queues a callback update with the current text; an unknown data throws "no such button"; (e) `botEdit` keeps the old text in `edits`; (f) `nextUpdate` resolves early when `sendAsUser` runs, and at the time limit when nothing comes.
  - Check: `bun test tools/fake-telegram/src && bun run typecheck && bun run lint`
  - Done when: the tests pass.
  - Out of scope: HTTP, limits and error responses, the driver.

- [x] **1.3 HTTP server with the Bot API methods**
  - Goal: a Bun HTTP server that answers the 7 Bot API methods that grammY and the app call, on top of the state.
  - Files: `tools/fake-telegram/src/server.ts` (new), `tools/fake-telegram/src/server.test.ts` (new), `tools/fake-telegram/src/index.ts` (re-export).
  - Interfaces:
    ```ts
    export interface FakeTelegramOptions {
      port?: number /* default 0 */;
      token?: string /* default FAKE_TOKEN */;
      bot?: FakeBotInfo;
    }
    export interface FakeTelegram {
      apiRoot: string; // "http://127.0.0.1:<port>", no trailing "/" (grammY throws on a trailing "/": node_modules/grammy/out/core/client.js:87)
      port: number;
      token: string;
      state: FakeState;
      stop(): Promise<void>;
    }
    export function startFakeTelegram(opts?: FakeTelegramOptions): FakeTelegram;
    ```
  - Decisions:
    - grammY calls `POST <apiRoot>/bot<token>/<method>` with a JSON body (`defaultBuildUrl`, `node_modules/grammy/out/core/client.js:150`). Route on the path `/bot<token>/<method>`; read the body with `request.json()`, an empty or bad body = `{}`. Accept `GET` too (no body).
    - Every answer is `{ ok: true, result }` with HTTP 200. Stage 1 does not check the token (stage 2 does). An unknown method in stage 1: `{ ok: false, error_code: 404, description: "Not Found" }`, HTTP 404.
    - `getMe` → `{ id, is_bot: true, first_name, username, can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false }`.
    - `deleteWebhook` → `true` (grammY `bot.start()` calls it before the first `getUpdates`). `setMyCommands` → `true`, and stores `payload.commands` in `state.commands`.
    - `getUpdates`: payload `offset?`, `limit?` (default 100, clamp to 1–100), `timeout?` (seconds, default 0), `allowed_updates?` (ignored). Call `takeUpdates`. When the result is empty and `timeout > 0`, wait with `nextUpdate(request.signal, min(timeout, 8) * 1000)`, then call `takeUpdates` once more and answer (can be `[]`). The 8-second cap: Bun closes an idle connection after its `idleTimeout` (default 10 s) [not verified]; an early empty answer is valid Bot API behaviour and grammY polls again. Also set `idleTimeout: 30` in `Bun.serve`.
    - In stage 1, a new `getUpdates` call while another one waits ends the waiting one with `[]` (stage 2 changes this to a 409).
    - `sendMessage`: payload `chat_id` (number or numeric string), `text`, `reply_markup?.inline_keyboard` → `state.botSend` → result `toBotApiMessage(...)`. Ignore `parse_mode` and `link_preview_options`.
    - `editMessageText`: payload `chat_id`, `message_id`, `text`, `reply_markup?`. Buttons = `reply_markup.inline_keyboard` mapped to `FakeButton`; a missing `reply_markup` removes the keyboard (`[]`) [not verified; the app always sends `reply_markup` on edit, `api.ts:66`, `bot.ts:133`]. Result: the edited message (`toBotApiMessage`).
    - `answerCallbackQuery`: payload `callback_query_id`, `text?` → `state.answerCallback` → `true`.
    - The server binds `hostname: "127.0.0.1"` (R4). No log line in the server.
  - Test: `server.test.ts`, each test starts its own fake on port 0 and stops it in `afterEach`:
    - (a) `new Api(FAKE_TOKEN, { apiRoot }).getMe()` gives `username === "fake_ea_bot"`.
    - (b) A real grammY `Bot` (`new Bot(FAKE_TOKEN, { client: { apiRoot } })`) with ``bot.command("start", (ctx) => ctx.reply(`hi ${ctx.match}`, { reply_markup: { inline_keyboard: [[{ text: "Yes", callback_data: "y" }]] } }))`` and `bot.on("callback_query:data", async (ctx) => { await ctx.answerCallbackQuery({ text: "ok" }); await ctx.editMessageText("done") })`. Start with `void bot.start()`. `state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "/start abc" })`; poll the state (50 ms steps, at most 5 s) until a bot message "hi abc" exists; `state.pressButton(...)` with data `y`; wait until the callback is answered with "ok" and the message text is "done" with `edits` `["hi abc"]` and no buttons. Then `await bot.stop()`.
    - (c) raw `fetch` of `getUpdates` with `{ timeout: 1 }` and no update answers `[]` after about 1 s (≥ 900 ms); with a `sendAsUser` 200 ms after the call it answers within 1 s with that update.
    - (d) `setMyCommands` stores the commands; `deleteWebhook` answers `true`.
  - Check: `bun test tools/fake-telegram/src && bun run typecheck && bun run lint`
  - Done when: the tests pass and `bun run test:unit` passes.
  - Out of scope: token check, limits and error shapes (stage 2); control routes, driver, CLI (stage 3); any app change.

### Stage 2 — Limits and errors [risky]

4096-character text, 64-byte `callback_data`, "message is not modified", the 400 / 401 / 409 / 429 response shapes (`ok: false`, `error_code`, `description`, `parameters.retry_after`), and switches to inject a 409 or a 429.

- [x] **2.1 Bot API errors, limits and fault injection [risky]**
  - Goal: the fake rejects what Telegram rejects (for the calls our app makes) with the same response shape, and a test can make the next call of a method fail with 409 or 429.
  - Files: `tools/fake-telegram/src/errors.ts` (new), `tools/fake-telegram/src/state.ts`, `tools/fake-telegram/src/server.ts`, `tools/fake-telegram/src/limits.test.ts` (new), `tools/fake-telegram/src/compat.test.ts` (new), `tools/fake-telegram/src/index.ts`.
  - Interfaces:
    ```ts
    // errors.ts
    export class BotApiError extends Error { constructor(readonly code: number, readonly description: string, readonly retryAfter?: number) }
    export function errorResponse(error: BotApiError): Response; // HTTP status = code; body { ok: false, error_code, description, parameters?: { retry_after } }
    export const DESCRIPTIONS: { unauthorized; notFound; chatNotFound; textEmpty; textTooLong; buttonDataInvalid; editNotFound; notModified; queryInvalid; conflict; tooManyRequests(retryAfter: number): string };
    export const TEXT_MAX_CHARS = 4096; export const CALLBACK_DATA_MAX_BYTES = 64;
    // server.ts, added to FakeTelegram
    failNext(method: string, fault: { code: 409 } | { code: 429; retryAfter: number }, times?: number /* default 1 */): void;
    ```
  - Decisions:
    - Response shape (`notes/2026-11-06-telegram-bot-facts.md`, grammY `GrammyError`): `{ ok: false, error_code: <n>, description: <text> }`, plus `parameters: { retry_after: <seconds> }` only for 429. HTTP status = `error_code`.
    - The state functions throw `BotApiError` (replace the plain `Error` throws of `botEdit`, `answerCallback`); `pressButton` keeps plain errors (it is the user side, not the Bot API). The server maps `BotApiError` with `errorResponse`; any other thrown error → HTTP 500 `{ ok: false, error_code: 500, description: "Internal Server Error" }`.
    - Order of checks per call: (1) token, (2) injected fault, (3) method exists, (4) method checks.
    - Descriptions (the exact Telegram texts are [not verified] except the substring "message is not modified", which `isNotModified` in `apps/server/src/modules/channels/telegram/errors.ts:22` reads; keep that substring exact):
      - 401 `Unauthorized`: the token in the path is not the fake's token. Every method.
      - 404 `Not Found`: unknown method.
      - 400 `Bad Request: chat not found`: `sendMessage` / `editMessageText` to a chat that has no user message yet (`!state.hasChat(chatId)`). A bot cannot write first in a private chat.
      - 400 `Bad Request: message text is empty`: `text` missing, not a string, or `text.trim() === ""`.
      - 400 `Bad Request: message is too long`: `text.length > 4096`. Count JS `string.length` (UTF-16 units), as the app does (`MESSAGE_MAX_CHARS` guard in `api.ts:31`; the notes say how Telegram counts is not verified).
      - 400 `Bad Request: BUTTON_DATA_INVALID`: any button with no `callback_data`, or `Buffer.byteLength(callback_data)` 0 or > 64. Checked in `sendMessage` and `editMessageText`.
      - 400 `Bad Request: message to edit not found`: `editMessageText` of an unknown message id or of a user message.
      - 400 `Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a content and reply markup of the current message`: `editMessageText` with the same text and the same buttons (deep-equal `{text, data}` rows; missing markup = `[]`).
      - 400 `Bad Request: query is too old and response timeout expired or query ID is invalid`: `answerCallbackQuery` with an unknown id or an id that was answered already.
      - 409 `Conflict: terminated by other getUpdates request; make sure that only one bot instance is running`: (a) injected; (b) real behaviour: a new `getUpdates` while another one waits ends the waiting one with this 409 (replaces the stage 1 `[]`). A waiting call whose `request.signal` is aborted (grammY `bot.stop()`) is removed from the wait and gets no 409.
      - 429 `Too Many Requests: retry after <n>` with `parameters.retry_after = n`: injected only. The fake has no real rate limit (out of scope).
    - `failNext(method, fault, times)`: the next `times` calls of `method` (with a good token) get the fault, then calls work again. Faults of several methods are independent.
  - Test:
    - `limits.test.ts` (grammY `Api` against the fake; assert `GrammyError` with `error_code`, `description`, and for 429 `parameters.retry_after`): wrong token → 401 on `getMe`; unknown method via `api.raw` or `fetch` → 404; `sendMessage` before any user message → 400 chat not found; text `""`, `" "` → empty; `"a".repeat(4096)` accepted, `"a".repeat(4097)` → too long; `callback_data` of 64 bytes accepted, 65 bytes (`"ż".repeat(33)` = 66 bytes) → BUTTON_DATA_INVALID; edit with same text and buttons → not modified, edit with same text but other buttons → accepted; edit of message 999 → not found; second `answerCallbackQuery` of one id → query invalid; `failNext("sendMessage", { code: 429, retryAfter: 3 })` → first call 429 with `retry_after: 3`, second call ok; `failNext("getUpdates", { code: 409 })` → a grammY `bot.start()` rejects with `GrammyError` 409 (notes: the polling loop rethrows 409); two parallel raw `getUpdates` with `timeout: 5` → the first answers 409, the second waits.
    - `compat.test.ts` (R1 allows tool → app imports): import `isNotModified` and `toChannelError` from `../../../apps/server/src/modules/channels/telegram/errors` and `createTelegramApi`, `createTelegramChannel` from `../../../apps/server/src/modules/channels/telegram/api`. Against the fake (first call `state.sendAsUser({ chatId: DEFAULT_CHAT_ID, text: "hi" })`, so the chat exists; only the unknown-chat case skips it): `channel.edit` with the same content resolves (the app treats not-modified as success); `channel.send` under an injected 429 (`retryAfter: 3`) rejects with `ChannelError` kind `rate_limited` and retry 3000 ms; a channel with a wrong token rejects with kind `config`; `channel.send` to an unknown chat rejects with kind `bad_request`. Read the `ChannelError` fields in `apps/server/src/modules/channels/port.ts` for the exact names.
  - Check: `bun test tools/fake-telegram/src && bun run typecheck && bun run lint && bun run test:unit`
  - Done when: all tests pass; no description text appears in any log line of the fake (it has no log).
  - Out of scope: real rate limits, webhooks, media, groups; any change in `apps/*`; fault injection from the CLI.

### Stage 3 — Driver

TS API and a non-interactive CLI (`fake-tg serve | send | press | read | wait`) with clear output and exit codes: send a text or command as a user (`/start <code>`, `/digest`), press an inline button, read a chat (messages, buttons, edits), wait until a bot message matches a pattern.

- [x] **3.1 Control routes on the fake**
  - Goal: a second process (the CLI, a script) can act as the user and read the chats over HTTP.
  - Files: `tools/fake-telegram/src/control.ts` (new: the route handler, called by `server.ts` for paths that start with `/_fake/`), `tools/fake-telegram/src/server.ts`, `tools/fake-telegram/src/state.ts` (only if a getter is missing), `tools/fake-telegram/src/control.test.ts` (new).
  - Interfaces (JSON in and out; every answer is `{ ok: true, ... }` or `{ ok: false, error: "<text>" }`):
    - `GET /_fake/health` → `{ ok: true, bot: { id, username } }`.
    - `POST /_fake/send` `{ chatId?: number, text: string }` → `{ ok: true, updateId, messageId }`.
    - `POST /_fake/press` `{ chatId?: number, messageId?: number, button?: string, data?: string }` → `{ ok: true, updateId, callbackId, messageId, data }`.
    - `GET /_fake/chats` → `{ ok: true, chats: [{ chatId, messages: <count> }] }`.
    - `GET /_fake/chats/<chatId>` → `{ ok: true, chatId, messages: FakeMessage[], callbacks: FakeCallback[] }`.
    - `GET /_fake/callbacks/<id>` → `{ ok: true, callback: FakeCallback }`.
  - Decisions:
    - `chatId` defaults to `DEFAULT_CHAT_ID`.
    - `press` needs exactly one of `button` (exact button text, for example `↩️ 1`) or `data`. Without `messageId`, take the newest bot message of the chat that has a matching button. No match → HTTP 404 `{ ok: false, error: "no such button" }`. Both or none of `button` / `data` → HTTP 400.
    - Bad JSON or a missing `text` → HTTP 400. Unknown chat or callback → HTTP 404.
    - The control routes need no token: the fake listens on loopback only (R4). A POST control route needs the header `content-type: application/json` (a media type parameter such as `; charset=utf-8` is fine), else HTTP 415 `{ ok: false, error: "content-type must be application/json" }`. Reason: a web page in a local browser can send a CORS simple POST (`text/plain`) to `127.0.0.1`. Add a 415 case to the test.
  - Test: `control.test.ts`: send → the update reaches a grammY bot (or `state.takeUpdates`); a chat read shows a bot message with buttons and its `edits`; press by button text and by data; press with an unknown text → 404; press with both fields → 400; health shows the bot user name.
  - Check: `bun test tools/fake-telegram/src && bun run typecheck && bun run lint`
  - Done when: the tests pass.
  - Out of scope: the TS client and the CLI (3.2, 3.3).

- [x] **3.2 TS driver client**
  - Goal: a typed client of the control routes for scripts and tests, with wait helpers.
  - Files: `tools/fake-telegram/src/driver.ts` (new), `tools/fake-telegram/src/driver.test.ts` (new), `tools/fake-telegram/src/index.ts`.
  - Interfaces:
    ```ts
    export class FakeTelegramTimeout extends Error {}
    export class FakeTelegramUnreachable extends Error {} // fetch failed to connect
    export class FakeTelegramRequestError extends Error { constructor(readonly status: number, message: string) }
    export interface FakeTelegramClient {
      health(): Promise<{ bot: { id: number; username: string } }>;
      send(text: string, opts?: { chatId?: number }): Promise<{ updateId: number; messageId: number }>;
      press(opts: { chatId?: number; messageId?: number; button?: string; data?: string; timeoutMs?: number }): Promise<{ callbackId: string; messageId: number; answer: string }>;
      read(opts?: { chatId?: number }): Promise<FakeMessage[]>;
      waitFor(pattern: RegExp, opts?: { chatId?: number; timeoutMs?: number; afterMessageId?: number }): Promise<FakeMessage>;
    }
    export function createFakeTelegramClient(url: string): FakeTelegramClient;
    ```
  - Decisions:
    - `press` sends the press, then polls `/_fake/callbacks/<id>` every 100 ms until `answered`; it returns `answer = answerText ?? ""`. No answer within `timeoutMs` (default 10 000) → `FakeTelegramTimeout`.
    - `waitFor` polls the chat every 100 ms. It returns the first bot message (oldest first) with `messageId > afterMessageId` (default 0) whose current text matches. An edit that makes an old message match counts. Timeout default 30 000 ms → `FakeTelegramTimeout`.
    - A control answer with `ok: false` → `FakeTelegramRequestError(status, error)`. A connection failure → `FakeTelegramUnreachable`.
  - Test: `driver.test.ts` with a fake on port 0 and a small grammY bot (echo command with one button whose tap answers "tapped" and edits the text): `send` + `waitFor` returns the reply; `press` returns `answer === "tapped"`; `waitFor` with a pattern that never matches and `timeoutMs: 300` throws `FakeTelegramTimeout`; a client on a closed port throws `FakeTelegramUnreachable`.
  - Check: `bun test tools/fake-telegram/src && bun run typecheck && bun run lint`
  - Done when: the tests pass.
  - Out of scope: the CLI.

- [x] **3.3 CLI `fake-tg`**
  - Goal: a non-interactive CLI with which an agent starts the fake and plays the user.
  - Files: `tools/fake-telegram/src/cli.ts` (new), `tools/fake-telegram/src/cli.test.ts` (new), root `package.json` (script `"fake-tg": "bun tools/fake-telegram/src/cli.ts"`).
  - Interfaces:
    ```ts
    export interface CliIo {
      out(line: string): void;
      err(line: string): void;
      env: Record<string, string | undefined>;
    }
    export async function runCli(argv: string[], io: CliIo): Promise<number>; // the exit code
    // at the end of cli.ts: if (import.meta.main) runCli(process.argv.slice(2), <process io>).then((code) => process.exit(code))
    ```
    Commands (parse with `node:util` `parseArgs`, `allowPositionals: true`, `strict: true`, as the server scripts do):
    - `serve [--port <n>]` — default port `DEFAULT_PORT` (8090). Token: env `FAKE_TG_TOKEN`, else `FAKE_TOKEN`. Prints `fake Telegram on http://127.0.0.1:<port> (bot @<username>, id <id>)`, then `TELEGRAM_API_ROOT=http://127.0.0.1:<port>`, then `TELEGRAM_BOT_TOKEN=<FAKE_TOKEN>` only when the token is the default `FAKE_TOKEN` (never print a token from the env, R4). Runs until SIGINT / SIGTERM, then stops the server and returns 0.
    - `send <text> [--chat <id>]` — prints `sent #<messageId> (update <updateId>)`.
    - `press (--button <text> | --data <data>) [--message <id>] [--chat <id>] [--timeout <s>]` — prints `pressed "<button or data>" on #<messageId>` and `answer: <text>`.
    - `read [--chat <id>] [--last <n>]` — prints the messages in the format below.
    - `wait <regex> [--chat <id>] [--timeout <s, default 30>] [--after <messageId>]` — prints the matched message.
    - Global options: `--url <base>` (default env `FAKE_TG_URL`, else `http://127.0.0.1:8090`), `--json` (print the result as one JSON line instead of text).
  - Decisions:
    - Exit codes: `0` success; `1` timeout, no such button, no such chat or message; `2` usage error (unknown command, bad option, bad regex); `3` the fake is not reachable. Errors go to `io.err` as one line `fake-tg: <reason>`.
    - Message text format (read, wait):
      ```
      #<messageId> <bot|user> <HH:MM:SS> UTC[ · edited <n>x]
      <text, as is, several lines allowed>
        [<button text> => <data>]  [<button text> => <data>]   (one line per keyboard row)
      ```
      A blank line between messages.
    - The regex of `wait` is a JS `RegExp` built from the argument, flag `s` (dot matches a line break).
    - The CLI never prints a token from the env (R4).
  - Test: `cli.test.ts` calls `runCli` with a captured `io` against an in-process fake (port 0, `--url`) and a small grammY bot: `send "/start x"` → 0; `wait "hi x"` → 0 and the output has `#2 bot`; `read` shows a button row line `[Yes => y]`; `press --button Yes` → 0 with `answer:`; `wait "never" --timeout 0.3` → 1; `bogus` → 2; `read --url http://127.0.0.1:1` → 3; `--json read` prints valid JSON. A `serve` test: spawn `Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts"), "serve", "--port", "0"], { stdout: "pipe" })`, read the real port from the first stdout line (`serve` prints the bound `server.port`), call `/_fake/health`, then `kill()` and expect the exit code 0 (or the signal exit). Keep the test under 5 s.
  - Check: `bun test tools/fake-telegram/src && bun run typecheck && bun run lint && bun run test:unit`; manual: `bun run fake-tg serve` in one shell and `bun run fake-tg send hello && bun run fake-tg read` in another (output in the stage report).
  - Done when: the tests pass and the manual check shows the user message.
  - Out of scope: fault injection from the CLI, an interactive mode, the README (stage 6).

### Stage 4 — App hook [risky]

`TELEGRAM_API_ROOT` in `platform/config.ts` with the loopback-only rule (U3), passed in `main.ts` to the runtime and in the `telegram:check` / `telegram:link` scripts; one start log line when it is set; `.env.example` entry.

- [x] **4.1 `TELEGRAM_API_ROOT` (loopback only) in the config, the server and the scripts [risky]**
  - Goal: when `TELEGRAM_API_ROOT` is set to a loopback URL, the server and the two scripts talk to that Bot API; every other value stops the start.
  - Files: `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts`, `apps/server/src/main.ts`, `apps/server/src/modules/channels/telegram/runtime.ts` (comment only), `apps/server/src/scripts/telegram-check.ts`, `apps/server/src/scripts/telegram-link.ts`, `.env.example`, `apps/server/test/integration/telegram-api-root.test.ts` (new).
  - Interfaces:
    - Config key `TELEGRAM_API_ROOT: string | undefined` in `baseSchema`: `z.preprocess(emptyAsUndefined, z.string().refine(isLoopbackApiRoot, "must be http(s)://127.0.0.1, ::1 or localhost, with no path").optional())`.
    - `export function isLoopbackApiRoot(value: string): boolean` in `config.ts` (exported for the tests).
    - `main.ts`: pass `apiRoot: config.TELEGRAM_API_ROOT` to `createTelegramRuntime`.
    - Scripts: `checkBot(token, { apiRoot: config.TELEGRAM_API_ROOT })` in `telegram-check.ts:28` and `telegram-link.ts:63`.
  - Decisions:
    - U3: accept only a host that is loopback: `127.0.0.1`, `::1`, `localhost`. No new `APP_ENV` key. Reason: the config has no dev/prod setting; a loopback root never reaches a real or remote server, and the pilot never runs the fake.
    - `isLoopbackApiRoot`: parse with `new URL(value)` (a parse error → false). True only when `url.protocol` is `http:` or `https:`, `url.hostname` is exactly `127.0.0.1`, `localhost` or `[::1]` (Bun 1.4.4 keeps the brackets, checked by the plan review 2026-11-07), and `url.origin === value`. The `origin` check drops userinfo, path, query, hash and a trailing `/`, so every such value is rejected. Reason for the trailing `/`: grammY throws on an `apiRoot` that ends with `/` (`node_modules/grammy/out/core/client.js:87`). So `http://127.0.0.1:8090` is valid and `http://127.0.0.1:8090/` is not (the error message says "no path").
    - The config error names only the key (`ConfigError` keys), never the value (existing rule; the test checks it).
    - Empty or missing = the real Telegram (`https://api.telegram.org`, grammY default).
    - Start log line in `main.ts`, only when the key is set and Telegram is on: ``log.warn(`telegram: TELEGRAM_API_ROOT is set: the bot talks to the Bot API at ${config.TELEGRAM_API_ROOT}, not to Telegram`)``. The value is a checked loopback URL with no token, so it may be logged. When the key is set but `TELEGRAM_BOT_TOKEN` is empty, log nothing extra (Telegram is off).
    - The scripts print nothing new; they pass the value on.
    - `runtime.ts:24` comment `// Only for tests.` becomes `// Tests, and TELEGRAM_API_ROOT (loopback only, platform/config).` (keep it for `botInfo`: put `botInfo` under its own `// Only for tests.` comment).
    - `.env.example`, after `TELEGRAM_BOT_TOKEN=`: a comment `# Dev only: a local fake Bot API (tools/fake-telegram). Use http://127.0.0.1:<port> (the fake binds only 127.0.0.1); the config also accepts localhost and [::1]; no path, no trailing "/". Empty = the real Telegram.` and `TELEGRAM_API_ROOT=`.
    - U4: the new integration test uses its own small ad-hoc `Bun.serve` fake (as `check.test.ts` does). It does not import `tools/` (R1).
  - Test (write first):
    - `config.test.ts`: accepted: `http://127.0.0.1:8090`, `http://localhost:8090`, `http://[::1]:8090`, `https://127.0.0.1`; empty string → `undefined`; rejected (ConfigError key `TELEGRAM_API_ROOT`, message without the value): `https://api.telegram.org`, `http://10.0.0.5:8090`, `http://127.0.0.1.example.test`, `http://localhost.example.test`, `http://127.0.0.1@evil.test`, `http://user:pw@127.0.0.1:8090`, `http://127.0.0.1:8090/`, `http://127.0.0.1:8090/bot`, `http://127.0.0.1:8090?`, `http://127.0.0.1:8090#`, `ftp://127.0.0.1`, `127.0.0.1:8090`, `http://0.0.0.0:8090`.
    - `telegram-api-root.test.ts` (integration, needs `DATABASE_URL` and `CREDENTIALS_KEY` from env as in CI): start a `Bun.serve` on `127.0.0.1` port 0 that answers `getMe` with `{ ok: true, result: { id: 77, is_bot: true, first_name: "T", username: "root_test_bot" } }` and records the path; spawn `bun apps/server/src/scripts/telegram-check.ts` with env `{ ...process.env, TELEGRAM_BOT_TOKEN: "123456:ROOTTESTaaaaaaaaaaaaaaaaaaaaaaaaaaaa", TELEGRAM_API_ROOT: <fake root> }` → exit 0, output contains `@root_test_bot`, the fake got `/bot123456:…/getMe`; with `TELEGRAM_API_ROOT: "https://api.telegram.org"` → exit 1, output names `TELEGRAM_API_ROOT` and has no token. Follow the spawn pattern of `apps/server/test/integration/mail-connect.test.ts` (`repoRoot`, script path). Bun loads `.env` of the working directory; set every key that the test needs in the spawn env [not verified: shell env wins over `.env` in Bun].
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: the tests pass; `grep -n TELEGRAM_API_ROOT apps/server/src/main.ts apps/server/src/scripts/telegram-*.ts .env.example` shows the 4 uses.
  - Out of scope: a new env marker (`APP_ENV`, `NODE_ENV`); changes in `api.ts`, `bot.ts`, `check.ts`, `polling.ts` (they accept `apiRoot` already); `telegram:link` text changes; any import of `tools/`.

### Stage 5 — End-to-end test

An automated test that runs the fake, the server Telegram runtime, the dev DB and GreenMail: link the chat → urgent notice → digest → button press → result checked in the DB and in GreenMail. Runs in `bun run test:int` and in CI (U5).

- [x] **5.1 Test command and GreenMail mailbox setup**
  - Goal: `test:int` runs the tool's end-to-end folder, and a helper builds an org with a real GreenMail mailbox in a test transaction.
  - Files: root `package.json` (`test:int` becomes `bun test apps/server/test tools/fake-telegram/test`), `tools/fake-telegram/test/setup.ts` (new).
  - Interfaces:
    ```ts
    export interface E2eMailbox {
      ctx: { orgId: string };
      userId: string;
      mailboxId: string;
      imap: ImapConnectOptions;
      secrets: SecretBox;
    }
    export async function createGreenmailMailbox(trx: Transaction<DB>): Promise<E2eMailbox>;
    export async function appendUrgentSeed(box: E2eMailbox, input: { subject: string }): Promise<{ messageId: string }>;
    export function urgentLlm(): LlmClient; // a stub classifier that answers category "urgent"
    ```
  - Decisions:
    - R1: imports go from `tools/` to the app: `../../../apps/server/src/...` and `../../../apps/server/test/integration/{fixtures,helpers}`.
    - GreenMail (as `apps/server/test/integration/imap-contract.test.ts`): host `process.env.TEST_IMAP_HOST ?? "127.0.0.1"`, port `Number(process.env.TEST_IMAP_PORT ?? "3143")`, user `u-<uuid>@localhost`, password `greenmail-test`; auth is off, so the first login creates the user. Plain IMAP on loopback (`secure` defaults to false for a loopback host).
    - `createGreenmailMailbox`: `pauseOtherMailboxes(trx)` and `isolateChannels(trx)` first (the jobs read all organizations); `createOrgWithMailbox(trx, { address: <greenmail user> })`; update the `mailboxes` row: `imap_host`, `imap_port` = GreenMail, and the capabilities of GreenMail (`notes/2026-11-03-greenmail-facts.md`: MOVE, UIDPLUS, IDLE, no CONDSTORE, no SPECIAL-USE); `insertCredentials` (only in `apps/server/src/modules/mail/repo.ts:237`, import that file) with `secrets.encrypt("greenmail-test", "mailbox:" + mailboxId)` written as a template literal (as `actions-end-to-end.test.ts:61`), secrets = `createSecretBox(randomBytes(32).toString("base64"), 1)` (`createSecretBox` and `SecretBox` from `apps/server/src/platform/crypto.ts`); `insertDefaultSettings` (exported from `modules/config`) if the row does not exist yet, then `updateMailboxSettings` (exported from `modules/config`; it needs the full `ToolSwitches` object, `config/repo.ts:76`) with `mode: "assist"` and `toolSwitches: parseToolSwitches({ flag: true })` from `@ea/core`. The policy applies `flag` for an urgent mail when the mode is `assist` and the switch is on (`packages/core/src/triage/planners.ts:86`, `policy.ts:40-42`).
    - `appendUrgentSeed`: `appendRaw` (only in `apps/server/src/modules/mail/imap/tools.ts:5`, import that file) with `(imap, "INBOX", renderSeedMessage({ messageId, from: "boss@example.test", to: [address], subject, date: new Date(), text: "Please call me today." }))`, where `messageId` is `<e2e-<uuid>@ea-seed.test>` (build it with a template literal). The `@ea-seed.test` Message-ID makes the mail synthetic, so `TRIAGE_LLM_SCOPE=synthetic` and `ACTIONS_SCOPE=synthetic` take it.
    - `urgentLlm`: as `fakeLlm()` in `apps/server/test/integration/triage-job.test.ts:40`, but `category: "urgent"`, `confidence: 0.95`, `reason_code: "deadline_today"` (codes in `packages/core/src/triage/categories.ts:14`; schema `buildTriageAnalysisSchema` in `packages/core/src/triage/analysis.ts:8`), a short `reason` and `summary`, `fields` as in that file. The classifier schema of S4 can need more fields: build the object so that `req.schema.parse` passes.
  - Test: none of its own; 5.2 uses it. Typecheck and lint check it.
  - Check: `bun run lint && bun run typecheck && bun run test:unit` (the unit run must not pick up `tools/fake-telegram/test`, R3).
  - Done when: checks pass; `bun run test:unit` output lists no file of `tools/fake-telegram/test`.
  - Out of scope: the test flow itself; changes in `apps/*`.

- [x] **5.2 The end-to-end test**
  - Goal: one test runs link → urgent notice → digest → button press against the fake, the real runtime, the DB and GreenMail, and checks the result in the DB and in GreenMail.
  - Files: `tools/fake-telegram/test/e2e.test.ts` (new).
  - Interfaces: uses `startFakeTelegram`, `createFakeTelegramClient`, `FAKE_TOKEN`, `DEFAULT_CHAT_ID` (stages 1–3), `createTelegramRuntime` and `createLinkToken` from `apps/server/src/modules/channels`, `createMailSyncJob` and `openImapProvider` from `apps/server/src/modules/mail`, `createTriageJob` and `createLlmPause` from `apps/server/src/modules/triage`, `createCommitterJob` from `apps/server/src/modules/actions`, `testDb` and `withRollback` from `apps/server/test/integration/helpers`, the 5.1 helpers.
  - Decisions:
    - All DB work runs in one `withRollback(db, async (trx) => …)` (the pattern of `apps/server/test/integration/telegram-logs.test.ts`); the runtime gets `db: trx`. The GreenMail user is new per run, so the mail left in GreenMail is harmless.
    - Real clock: `now: () => new Date()`, `startedAt: new Date(Date.now() - HOUR)`.
    - Runtime: `createTelegramRuntime({ db: trx, token: FAKE_TOKEN, now, startedAt, llmDailyCap: 300, triageScope: "synthetic", actionsScope: { kind: "synthetic" }, llm: { provider: "gemini", classifierModel: "fake-model" }, apiRoot: fake.apiRoot })`. No `botInfo`: grammY calls `getMe` on the fake (more real). `runtime.startPolling()`; In `finally`: first `await runtime.stop()`, then `fake.stop()` (`bot.stop()` sends one more `getUpdates`; a fake that is already stopped makes it log a polling warn). If `TelegramRuntimeDeps` or `CommitterDeps` have more required keys at build time (S4 stages 11, 12, 16, 18 add `hooks`, `uidplus`, `sendScope`, `openSender`, `compose`), build them as `main.ts` does, with sends off (`sendScope: { kind: "off" }`).
    - Flow and checks, in this order:
      1. Link: `createLinkToken(trx, ctx, userId, new Date())`; send `/start <token>` with `client.send` (template literal); `client.waitFor(/This chat is linked/)` (`LINKED_TEXT` in `apps/server/src/modules/channels/texts.ts`). DB: one `chat_links` row for the user, found with `.where("external_chat_id", "=", DEFAULT_CHAT_ID)` (the column is `Int8`, node-postgres returns a string: compare with `Number(row.external_chat_id)`, never `toBe(DEFAULT_CHAT_ID)` on the raw value). Then move the link back: `await trx.updateTable("chat_links").set({ linked_at: startedAt }).where("external_chat_id", "=", DEFAULT_CHAT_ID).execute()`. Reason: in one transaction `now()` is the transaction start, so the real triage row (`triage_results.created_at` default `now()`) is older than the JS link time, and `detectUrgent` (`channels/notices.ts:82`) skips mail triaged before `linked_at` (D13). Without this the notice in step 3 never comes.
      2. Mail: `appendUrgentSeed(box, { subject: "E2E urgent <uuid>" })`; run the jobs once each, in order: `createMailSyncJob({ db: trx, secrets, openProvider: openImapProvider, isOwnActionId: async () => false, now }).run()`, `createTriageJob({ db: trx, llm: urgentLlm(), pause: createLlmPause({ configHint: "test" }), scope: { kind: "synthetic" }, batchSize: 5, dailyCap: 300, now }).run()`, `createCommitterJob({ db: trx, secrets, openProvider: openImapProvider, scope: { kind: "synthetic" }, now }).run()`. Check the deps types in the real files (`mail/jobs.ts`, `triage/jobs.ts`, `actions/committer.ts`, `triage/pause.ts`) and adapt the names. DB: the mail has a `triage_results` row with `urgent` and a `flag` action with status `applied`. GreenMail (open `openImapProvider(box.imap)`, `fetchAbove(0)` or `fetchMetaIn("INBOX", uid)`): the mail is in INBOX with `\Flagged`.
      3. Urgent notice: `runtime.notify()`; `client.waitFor(/Urgent mail[\s\S]*E2E urgent/)`; the message has the buttons `✅ Right` and `✏️ Change`.
      4. Digest: `client.send("/digest")`; `client.waitFor(/E2E urgent/, { afterMessageId: <notice id> })`; the digest message has a button whose text starts with `↩️` (the flag is applied, so the mail is undoable: `apps/server/src/modules/reports/digest.ts:102`).
      5. Button press: `client.press({ messageId: <digest id>, button: <the ↩️ button text> })` → `answer` contains `Undo started` (`UNDO_TEXTS.started` in `callbacks.ts`). Run the committer once more. DB: a `triage_feedback` row with `source = 'undo'` for the mail (`channels/callbacks.ts:75-83`); a reverse action row with `reverses_action_id = <the flag action id>` and status `applied` (inserted as `ready` by `actions/repo.ts:495-515`, applied by the committer); the original `flag` action has status `undone` with `status_reason = 'undo'` (`actions/apply.ts:209-220`). GreenMail: the mail is in INBOX without `\Flagged`.
    - Each wait uses a timeout of at most 10 s; the whole test has a timeout of 60 000 ms.
    - If a job does not pick the mail (for example the sync takes only mail of the last N days, or the mailbox needs another setting), fix the setup in `setup.ts`, not the app. If the app itself blocks the flow, stop and report it to the main session.
  - Test: this file is the test.
  - Check: `bun run dev:up` (local GreenMail and DB), then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`. CI runs it through `test:int` (U5; `.github/workflows/ci.yml` has Postgres and GreenMail).
  - Done when: `bun run test:int` passes with the new test; the test fails when the `flag` action is not applied (check once by hand, for example with `tool_switches` `{}`, then restore).
  - Out of scope: a real LLM; SMTP; new app code; changes to the existing ad-hoc fakes (U4).

### Stage 6 — Runbook and live agent run

`tools/fake-telegram/README.md`, the test-tool line in `docs/code-patterns.md`, a note if facts were learned. The agent runs the scope item 5 flow alone through the CLI against the dev server and records the result in this file.

- [x] **6.1 README and docs**
  - Goal: a new agent can start and drive the fake with no chat history.
  - Files: `tools/fake-telegram/README.md` (new), `docs/code-patterns.md`.
  - Decisions:
    - README sections: what it is and what it is not (scope items 1–3; out of scope list of this task); start (`bun run fake-tg serve`, the printed env lines); point the dev server at it (`TELEGRAM_API_ROOT=http://127.0.0.1:8090` (always `127.0.0.1`, not `localhost`: the fake binds only `127.0.0.1`) and `TELEGRAM_BOT_TOKEN=<FAKE_TOKEN>` in the env of `bun run dev`, the loopback rule of stage 4); the CLI commands with one example each and the exit codes; the TS API (`startFakeTelegram`, `createFakeTelegramClient`, `failNext`) with a short example; the Bot API errors that the fake gives (stage 2 list); the end-to-end test and how to run it (`bun run dev:up`, `bun run test:int`); the border rule R1.
    - `docs/code-patterns.md`, section "Layout and borders", add this line as it is: "- Test tools live in `tools/<name>/` (workspace `tools/*`, first: `tools/fake-telegram/`). App code (`apps/*`, `packages/*`) never imports them, and the server image holds only their `package.json`."
    - ASD-STE100 for both texts (the repo rule).
  - Test: none.
  - Check: `bun run lint` (prettier for Markdown runs in lint-staged only; run `bunx prettier --check tools/fake-telegram/README.md docs/code-patterns.md`).
  - Done when: the README lets a reader do the 6.2 run without other files.
  - Out of scope: `docs/architecture.md` changes beyond what the main session asks.

- [x] **6.2 Live agent run against the dev server**
  - Goal: the agent runs the scope item 5 flow alone with the CLI against the dev server and records the result in this task file.
  - Files: this task file (a `## Results` section: date, commands, the key output lines, pass/fail per step); `notes/2026-11-07-fake-telegram.md` (new, only if facts were learned, for example a Bun or grammY behaviour).
  - Decisions:
    - Procedure (the agent adapts the exact flags to the real scripts and writes the real commands into the results):
      1. `bun run dev:up` and `bun run db:migrate`.
      2. Shell A: `bun run fake-tg serve`.
      3. Org and GreenMail mailbox for the run: `bun run org:create --org-name <name> --email <email> --display-name <name>`; `printf '%s' greenmail-test | bun run mailbox:connect --org-id <id> --address u-<uuid>@localhost --imap-host 127.0.0.1 --imap-port 3143 --smtp-host 127.0.0.1 --smtp-port 3025` (the password comes only from stdin; the defaults are Interia); `bun run mailbox:settings mode --org-id <id> --mailbox-id <id> --mode assist` (assist turns `flag` on by itself, `ASSIST_DEFAULT_SWITCHES`). Read each usage line first and write the real commands into the results.
      4. Shell B: `TELEGRAM_API_ROOT=http://127.0.0.1:8090 TELEGRAM_BOT_TOKEN=<FAKE_TOKEN> TRIAGE_LLM_SCOPE=synthetic ACTIONS_SCOPE=synthetic TEST_MAILBOX_ADDRESS=<greenmail user> bun run dev`. The log must show the stage 4 warn line and `telegram: polling as @fake_ea_bot`.
      5. `bun run telegram:link --org-id <id> [--user-id <id>]` with the same two Telegram env keys; take the token from the printed `t.me` link; `bun run fake-tg send "/start <token>"`; `bun run fake-tg wait "This chat is linked"`.
      6. Seed one urgent mail with a one-off `bun -e` script that uses the 5.1 helper `appendUrgentSeed` (subject `Live urgent <uuid>`). Do not use `mailbox:seed`: it has no subject option, its text is not urgent, and it refuses every mailbox except `TEST_MAILBOX_ADDRESS`. Wait for sync (every 5 min), triage and committer; `bun run fake-tg wait "Urgent mail" --timeout 600`.
      7. `bun run fake-tg send /digest`; `bun run fake-tg wait "<subject>" --after <notice id>`; `bun run fake-tg press --button "↩️ 1"` (use the real button text from `read`).
      8. Check the result: DB (`triage_feedback` source `undo`, the reverse action `applied`, the `flag` action `undone`) with `psql` on the dev DB; GreenMail flags with a one-off `bun -e` script that uses `openImapProvider` and `fetchMetaIn` (`mailbox:check` and `mailbox:audit` do not show flags): the mail has no `\Flagged`.
      9. Stop the server first, then the fake (Ctrl-C / `kill`); `bun run telegram:unlink --org-id <id> --user-id <id>` for the test chat.
    - The real dev bot token must not be in the env of shell B (the fake token replaces it), so no message reaches the real Telegram.
    - The triage of the seeded mail calls the real LLM (`TRIAGE_LLM_SCOPE=synthetic`, only synthetic mail); see question 3. If the LLM does not say `urgent`, record it and use the digest part of the flow with the category that it gave.
  - Test: the run is the test.
  - Check: the `## Results` section holds each step with its command and output line; `bun run lint && bun run typecheck && bun run test:unit && bun run test:int` still pass.
  - Done when: the flow ran end to end with the CLI only (or the result says which step failed and why).
  - Out of scope: real Telegram accounts; checks of how messages look on a phone; fixes in the app (open a new task in `tasks/planned/` for a bug found).

## Results

### Stage 6.2 live agent run (2026-11-07, 20:20–20:28 UTC, main session, Claude Code)

Result: **PASS**. The flow ran end to end with the CLI only. The real LLM (`LLM_PROVIDER=openai`, classifier `gpt-6-luna`, from the local `.env`, not changed) gave `urgent` (1 classifier call).

Change to the procedure: the run used its own database `email_assistant_faketg` on the dev Postgres (same roles and grants as `deploy/db-init/roles.sql`, then `db:migrate`), and the server on `PORT=8081`. Reason: the S4 session ran `test:int` on the shared dev DB again and again, so a dev server on `email_assistant` would break the "Shared runtime" rule. Side effect: no other linked dev chat was in that DB, so no outbox row of the real dev chat failed (question 4 did not apply). The database was dropped after the run. The env came from a wrapper that sources `.env` and overrides `DATABASE_URL`, `MIGRATOR_DATABASE_URL` (database name), `TELEGRAM_API_ROOT=http://127.0.0.1:8090`, `TELEGRAM_BOT_TOKEN=<FAKE_TOKEN>`, `TRIAGE_LLM_SCOPE=synthetic`, `ACTIONS_SCOPE=synthetic`, `TEST_MAILBOX_ADDRESS=<greenmail user>`, `PORT=8081`. The real dev bot token was not in the env.

| #   | Step         | Command (real)                                                                                                                                                                                                                                                                                                                                                                    | Key output                                                                                                                                                                                                                            | Result                                                                                                                    |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | DB           | `CREATE DATABASE email_assistant_faketg` + grants (psql as `postgres`); `MIGRATOR_DATABASE_URL=<…/email_assistant_faketg> bun run db:migrate`                                                                                                                                                                                                                                     | `Applied: 20261108000001_delegation.sql`                                                                                                                                                                                              | pass                                                                                                                      |
| 2   | Fake         | `bun run fake-tg serve`                                                                                                                                                                                                                                                                                                                                                           | `fake Telegram on http://127.0.0.1:8090 (bot @fake_ea_bot, id 1000001)`                                                                                                                                                               | pass                                                                                                                      |
| 3   | Org, mailbox | `bun run org:create --org-name "Fake TG live run" --email tester@example.test --display-name "Fake TG tester"`; `printf '%s' greenmail-test \| bun run mailbox:connect --org-id <org> --address u-<uuid>@localhost --imap-host 127.0.0.1 --imap-port 3143 --smtp-host 127.0.0.1 --smtp-port 3025`; `bun run mailbox:settings mode --org-id <org> --mailbox-id <mb> --mode assist` | `created org …`; `MOVE=yes UIDPLUS=yes CONDSTORE=no SPECIAL-USE=no KEYWORDS=yes`; `mode: assist`, `switch flag: on`                                                                                                                   | pass (note: `--email u-<uuid>@localhost` is refused: "Invalid email address"; the user e-mail is not the mailbox address) |
| 4   | Server       | `bun apps/server/src/main.ts` (no `--watch`) with the env above                                                                                                                                                                                                                                                                                                                   | `telegram: TELEGRAM_API_ROOT is set: the bot talks to the Bot API at http://127.0.0.1:8090, not to Telegram`; `telegram: polling as @fake_ea_bot (id 1000001)`                                                                        | pass                                                                                                                      |
| 5   | Link         | `bun run telegram:link --org-id <org>`; `bun run fake-tg send "/start <token>"`; `bun run fake-tg wait "This chat is linked" --timeout 30`                                                                                                                                                                                                                                        | `https://t.me/fake_ea_bot?start=<token>`; `sent #1 (update 1)`; server: `chat linked for user …`; wait exit 0                                                                                                                         | pass                                                                                                                      |
| 6   | Urgent mail  | one-off `bun` script with `appendUrgentSeed` (5.1), subject `Live urgent 67fbf586-…`; `bun run fake-tg wait "Urgent" --timeout 600`                                                                                                                                                                                                                                               | server: `sync … fetched 1, stored 1`; `triage …: category urgent code deadline_today`; `outbox …: sent urgent`; fake `#3 bot 20:25:30 UTC 🔴 Urgent mail · 🧪 test … → will flag [✅ Right] [✏️ Change]` (about 100 s after the seed) | pass                                                                                                                      |
| 7   | Digest, undo | `bun run fake-tg send /digest`; `bun run fake-tg wait "Live urgent 67fbf586-…" --after 3 --timeout 60`; `bun run fake-tg press --button "↩️ 1" --timeout 20`                                                                                                                                                                                                                      | `#5 📬 Digest now … NEEDS ACTION · 1 … → done: flag [✅ 1] [✏️ 1] [↩️ 1]`; `pressed "↩️ 1" on #5`; `answer: ↩️ Undo started: the mail goes back within a minute.`                                                                     | pass                                                                                                                      |
| 8   | Check        | psql: `actions` and `triage_feedback`; one-off `bun` script with `openImapProvider(…).fetchMetaIn("INBOX", 1)`                                                                                                                                                                                                                                                                    | original `flag`: status `undone`, reason `undo`; reverse `flag`: status `applied`; `triage_feedback` source `undo`: 1 row; `uid 1 flags: []` (no `\Flagged`)                                                                          | pass                                                                                                                      |
| 9   | Stop         | `kill -INT` server, `bun run telegram:unlink --org-id <org> --user-id <user>`, `kill -INT` fake; `DROP DATABASE email_assistant_faketg`                                                                                                                                                                                                                                           | `unlinked 1 chat(s)`; ports 8081 and 8090 free                                                                                                                                                                                        | pass                                                                                                                      |

### Second run with the README and the scripts (2026-11-07, 20:32–20:40 UTC)

After the stage 6 review (FAIL: the README did not cover the seed and the check), the fix added `tools/fake-telegram/scripts/seed-urgent.ts` and `check-undo.ts`. The main session ran the README section "Live run without the shared dev DB" step by step on a new database `email_assistant_faketg2` (dropped after the run). Result: **PASS**.

- `seed-urgent.ts` without `GM_USER` → usage line, exit 2. With `GM_USER` → `subject: Live urgent e1980e7b-…`, `message-id: <e2e-…@ea-seed.test>`. By mistake it ran twice, so 2 urgent mails were in the run (2 classifier calls, both `urgent`).
- Notice `#3 bot 20:35:30 UTC`; committer `applied 2`. `/digest` showed buttons `↩️ 1` and `↩️ 2`; both presses answered `↩️ Undo started: the mail goes back within a minute.`
- `check-undo.ts` → 2 × `action flag undone reason=undo reverse=no`, 2 × `action flag applied reason=- reverse=yes`, `triage_feedback undo: 2`, `uid 1 flags: []`, `uid 2 flags: []`, `OK: undo done`, exit 0.

## Questions for the user

Answered by the user on 2026-11-07: (a) for all 4 (the recommendations). The live run (6.2) uses the LLM provider and key of the local `.env` as they are; do not change the LLM settings.

1. **Where the end-to-end test lives.** U1 says app code never imports the fake. (a) `tools/fake-telegram/test/e2e.test.ts`, it imports the app (tool → app only); `test:int` adds that folder. (b) `apps/server/test/integration/`, it imports `tools/` (breaks U1 for tests). **Recommendation: (a).** The plan is written for (a). The same reason makes `test:unit` run only `tools/fake-telegram/src`, not all of `tools`.
2. **Stage size.** Stages 1 and 3 have 3 normal steps each, and can reach about 350–450 changed lines (package setup, state, server and tests; control routes, client, CLI and tests), more than the 300-line guide. (a) Keep the 6 stages as approved. (b) Split stage 1 into "skeleton + state" and "HTTP server", and stage 3 into "control routes + client" and "CLI" (8 stages). **Recommendation: (a)**: test tool code, low risk, and each step has its own tests.
3. **Live run (6.2) and the real LLM.** The seeded mail goes to the real LLM (synthetic mail only, as in the S2 dev runs). (a) Accept. (b) No LLM: the agent writes the triage rows with SQL (less real). **Recommendation: (a).**
4. **Live run (6.2) and the dev DB.** While the dev server polls the fake, the notifier and the digest job send the messages of all linked dev chats (also the user's real dev chat) to the fake. The fake answers "chat not found" (400) for a chat that never wrote to it, so those outbox rows become `failed` (`bad_request`) and never reach the phone. (a) Accept for the run window (dev only; the agent records the window). (b) The agent unlinks the real dev chat before the run; the user links it again on the phone after the run. **Recommendation: (a)**: dev data only, the pilot is not touched.

## Not verified

- Bun `Bun.serve` closes an idle connection after `idleTimeout` (default 10 s) also while a long-poll request waits. The plan caps the long poll at 8 s and sets `idleTimeout: 30`, so it works either way.
- Telegram removes the inline keyboard when `editMessageText` has no `reply_markup` (the app always sends `reply_markup` on edit).
- The exact Telegram description texts for chat not found, empty text, too long text, BUTTON_DATA_INVALID, message to edit not found, query too old, 409 conflict and 429 (only the substring "message is not modified" is used by the app).
- ~~Bun gives env keys of the shell priority over the `.env` file.~~ Confirmed 2026-11-07: the stage 4 integration test and the stage 6 live run (overrides of `DATABASE_URL`, `PORT`, `TELEGRAM_API_ROOT` worked).
- The exact deps names of `createMailSyncJob`, `createTriageJob`, `createCommitterJob`, `createLlmPause` and the classifier schema fields for the stub LLM (stage 5 reads them in the code).

## Done-checklist

- [x] Done-when checks pass, except two that wait: CI runs only on `master` (after the merge), and the image build needs Docker access (see the log of 2026-11-07, end of build).
- [x] `docs/` describe what was built: `docs/code-patterns.md` (test tools line), `deploy/README.md` (no `TELEGRAM_API_ROOT` on the VPS), `.env.example`. The `docs/architecture.md` line moved to `tasks/planned/fake-telegram-followups.md` (prettier reason). No ADR.
- [x] Learned facts are in `notes/2026-11-07-fake-telegram.md`; no new alerts.
- [x] Follow-up ideas are in `tasks/planned/fake-telegram-followups.md`.
- [x] User try, then the merge into `master` (`tasks/README.md` § "Git mode"), CI green on `master`, `git mv` to `tasks/done/`, clean up the worktree and the branch.

## Log

- 2026-11-07: test-DC route probed and dropped; fake Telegram scope agreed with the user; placement outside the app decided.
- 2026-11-07: Plan session. Handoff claims checked against the code (differences: `deleteWebhook`, no dev marker in the config, Dockerfile lockfile, test-mail tool lives in the app). User approved the 6 stages and the recommendations U3–U5.
- 2026-11-07: Planner added the step detail. User answered questions 1–4: (a), the recommendations. User: the real LLM in 6.2 is fine, "Don't modify the LLM". Plan approved.
- 2026-11-07: Moved to `active/`. User: the build may run in parallel with S4; rules in "Parallel work with S4". Plan commit `059178c` is local: the push waits for the S4 commits below it (review pending), and this shell had no SSH key.
- 2026-11-07: Plan review (reviewer subagent, Opus, high): FAIL with 1 blocker and 15 minor findings, plus 1 question. All fixed in this file. Blocker: in 5.2 step 1, `linked_at` is set back to `startedAt`, because inside one transaction `now()` is older than the JS link time, so `detectUrgent` would skip the mail. Minor fixes: real import paths, the exact undo rows, the `Int8` chat id, the `origin` rule for `isLoopbackApiRoot`, 415 for non-JSON control POSTs, the real script flags in 6.2, the shared-files list, and broken code spans. Question 17 (localhost): the docs recommend `127.0.0.1` only, and the config still accepts `localhost` and `[::1]`.
- 2026-11-07: User: tasks with stages use worktrees by default. This task: `Git mode: worktree`; the "Parallel work with S4" rules are updated for the branch.
- 2026-11-07: Build session (Claude Code). Worktree created from `origin/master` `29ecf9f`. Stage 1 built (1.2 fix: R6 constants moved to `state.ts`). Review PASS with 2 minors (`hasChat` only after a user message; a non-finite `getUpdates` offset is ignored), fixed, re-review PASS. Checks: `bun run lint` exit 0, `bun run typecheck` all exit 0, `bun run test:unit` 950 pass 0 fail. Image check not run: `docker info` → permission denied for this user.
- 2026-11-07: Stage 2 built and reviewed: PASS with 2 minors (2 missing tests added; a harmless `?? ""` kept). User: run the whole plan without stops; use the recommendations when unsure. Checks: lint exit 0, typecheck all exit 0, `test:unit` 970 pass 0 fail.
- 2026-11-07: Stage 3 built and reviewed: PASS with 7 minors; 6 fixed (driver `read` gets `strict` for the CLI, so `fake-tg read` of an unknown chat exits 1; `waitFor` keeps polling), negative `--chat` left for later. Checks: lint exit 0, typecheck all exit 0, `test:unit` 993 pass 0 fail.
- 2026-11-07: `origin/master` merged into the branch before stage 4 (`51ca1ac`, no conflicts). Stage 4 built and reviewed: PASS, 1 minor (an explicit default port is refused; safe, no fix). Checks: lint exit 0, typecheck all exit 0, `test:unit` 1021 pass 0 fail, `telegram-api-root.test.ts` 2 pass.
- 2026-11-07: Stage 5 built and reviewed: PASS, no findings. `e2e.test.ts` 1 pass (16 expects, about 2 s); it fails when the `flag` switch is off (implementer negative check). Full `test:int` not run yet (shared runtime with S4).
- 2026-11-07: Stage 6 built. Live run 6.2 PASS on an own DB (reason: S4 ran `test:int` on the shared DB). Review FAIL (major: the README did not cover seed and check); fix: `seed-urgent.ts`, `check-undo.ts`, README steps; second run from the README PASS; re-review PASS. The `docs/architecture.md` line was dropped: lint-staged would reformat 238 lines of that file and conflict with S4.
- 2026-11-07: End of build. `git merge origin/master` (`f93043f`, no conflicts). Done-when checks: `bun run lint` exit 0; `bun run typecheck` all exit 0; `bun run test:unit` 1101 pass, 0 fail; `bun run test:int` 757 pass, 0 fail, 62 files, on an own DB `email_assistant_faketg_int` (dropped after), so the S4 test runs on the shared DB were not touched. Not run: the image build (`docker info` → permission denied; `sudo` needs a password) and CI (it runs only on `master`). Follow-ups: `tasks/planned/fake-telegram-followups.md`.
- 2026-11-07: Group review of stages 1–6: PASS, 4 minors. The undeclared `@ea/core` and `kysely` dev dependencies of `test/setup.ts` go to the follow-ups; the others are accepted. The reviewer also simulated the Dockerfile install (frozen lockfile, only the copied `package.json` files): it worked, and `tools/` held only `fake-telegram`.
- 2026-11-07: User: merge now; the follow-ups start as a new task (plan review with Opus, then the build). `git merge origin/master` (S4 stages 13–18): conflicts in `config.ts`, `config.test.ts`, `runtime.ts`, both sides kept; `e2e.test.ts` builds the new S4 deps (sends off). Merge review PASS, 1 minor fixed (`job-run` passes `apiRoot`). Checks: lint exit 0, typecheck all exit 0, `test:unit` 1111 pass, `test:int` 828 pass, 0 fail (own DB). The merge commit on `master` is made on top of `origin/master` from the worktree: the main checkout holds an S4 commit with a pending review that must not go out with this push.
- 2026-11-07: Merged into `master` as `8890d00` (made on `origin/master` from the worktree; the main checkout was not touched). CI failed on it: `e2e.test.ts` got no urgent notice at 21:04 UTC, because the channel sender holds notices in quiet hours (22:00–07:00 org time, default Europe/Warsaw). Fix `3c59bf5`: the test org gets `Etc/UTC` or `Etc/GMT-12`, whichever is outside quiet hours; proven red without the fix and green with it at 22:07 Warsaw time. CI run 42414374807: success. Worktree and branch removed.
