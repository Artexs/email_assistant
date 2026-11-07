# s2-telegram — Stage 0

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 0 — Setup: bots, grammY, config key, `telegram:check`

- [x] **0.1 User step: create the dev bot and the pilot bot (BotFather)**
  - Goal: two different bots exist; the dev token is in the Mac `.env`; the agent never sees a token.
  - Files: this task file (log line with the two bot user names; user names are not secret).
  - Interfaces: none.
  - Decisions (ADR 0005: one update consumer per token, so dev and pilot need two bots):
    - The main session stops and asks the user to do these steps in the Telegram app:
      1. Open `@BotFather`. Send `/newbot`. Name: for example "EA Dev". User name: must end in `bot`, for example `<name>_ea_dev_bot`.
      2. Send `/newbot` again for the pilot bot, for example `<name>_ea_bot`.
      3. For each bot: `/mybots` → the bot → Bot Settings → Allow Groups? → Turn groups off (the server accepts private chats only, D2).
      4. On the Mac, add one line to the repo `.env`: `TELEGRAM_BOT_TOKEN=<dev bot token>`. Do not paste the token into the chat with the agent.
      5. Keep the pilot token in a password manager. It goes only to the VPS `.env` in stage 23, never to the Mac `.env`.
      6. Tell the agent the two bot user names.
    - The agent checks only the key name, without the value: `grep -c '^TELEGRAM_BOT_TOKEN=.' .env` → `1`.
  - Test: none (user step).
  - Check: the grep above prints `1`.
  - Done when: the user says done and the grep prints `1`.
  - Out of scope: the pilot token on the VPS (stage 23), webhook setup (never: long polling only).

- [x] **0.2 grammY dependency, `TELEGRAM_BOT_TOKEN` config key, ESLint border**
  - Goal: the server can import grammY; the config reads the token; only the Telegram adapter folder may import grammY.
  - Files: change `apps/server/package.json` (dependency `"grammy": "^1.46.0"`), `bun.lock` (by `bun install`), `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts`, `.env.example`, `eslint.config.js`.
  - Interfaces: `Config["TELEGRAM_BOT_TOKEN"]: string | undefined`.
  - Decisions:
    - Add the dependency with `cd apps/server && bun add grammy@^1.46.0`, then `bun install` at the repo root. Check that `bun.lock` changed and `git diff apps/server/package.json` shows only the new line.
    - Config key, next to `GEMINI_API_KEY`, with the same empty-string rule: `TELEGRAM_BOT_TOKEN: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/).optional())`. Empty or missing = Telegram off (stage 20). A bad value stops the start with `ConfigError`; `loadConfig` reports only key names, never values (existing behaviour, keep it).
    - `.env.example`, a new block after the Gemini block:
      ```
      # Telegram bot token from @BotFather. Dev bot on the Mac, pilot bot on the VPS: never the same token
      # (one update consumer per token, ADR 0005). Empty = Telegram off. Secret: never print or log it.
      TELEGRAM_BOT_TOKEN=
      ```
    - `eslint.config.js`: add one config object after `nodeConfig` (D17):
      ```js
      {
        files: ["apps/server/src/**/*.ts", "packages/**/*.ts"],
        ignores: ["apps/server/src/modules/channels/telegram/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            { patterns: [{ group: ["grammy", "grammy/*"], message: "Only apps/server/src/modules/channels/telegram/ imports grammy (D17, ADR 0005)." }] },
          ],
        },
      },
      ```
      Tests in `apps/server/test/` are outside `src/`, so they may import grammY.
  - Test (`config.test.ts`): a value like `123456:ABCdefGhIJKlmNoPQRstuVWxyZ_-12345` is accepted; `""` gives `undefined`; `"abc"` throws `ConfigError` whose `keys` equal `["TELEGRAM_BOT_TOKEN"]` and whose `message` does not contain `abc`.
  - Check: `bun install && bun run lint && bun run typecheck && bun run test:unit`. Manual border check: add `import "grammy";` to `apps/server/src/main.ts`, run `bun run lint` → error with the D17 message; remove the line; `bun run lint` passes.
  - Done when: the checks pass and the manual border check failed and then passed as described.
  - Out of scope: any use of the token (step 0.3 and later).

- [x] **0.3 `bun run telegram:check` and the first error label**
  - Goal: the user and the agent can see which bot a token belongs to, without printing the token.
  - Files: create `apps/server/src/modules/channels/index.ts`, `apps/server/src/modules/channels/telegram/check.ts`, `apps/server/src/modules/channels/telegram/errors.ts`, `apps/server/src/modules/channels/telegram/check.test.ts`, `apps/server/src/scripts/telegram-check.ts`; change root `package.json` (script `"telegram:check": "bun apps/server/src/scripts/telegram-check.ts"`).
  - Interfaces:
    - `checkBot(token: string, opts?: { apiRoot?: string }): Promise<{ id: number; username: string }>` in `telegram/check.ts`: `new Api(token, opts?.apiRoot === undefined ? undefined : { apiRoot: opts.apiRoot }).getMe()` (grammY `Api` class).
    - `telegramErrorLabel(error: unknown): string` in `telegram/errors.ts`:
      - `GrammyError` → `` `GrammyError ${error.method} ${error.error_code}` ``.
      - `HttpError` → `` `HttpError ${method}` `` where `method` comes from `error.message` with `/^Network request for '([A-Za-z]+)' failed/`; no match → `"HttpError"`.
      - anything else → `describeError(error)` (`platform/errors.ts`).
      - Never `error.message` of an inner error, never `error.error`, `error.payload`, `error.description`.
    - `channels/index.ts` exports `checkBot` and `telegramErrorLabel` (the scripts and `main.ts` import only from the index).
  - Decisions:
    - Script style as `org-create.ts`: `loadConfig()`; no token → `log.error("TELEGRAM_BOT_TOKEN is not set")`, exit 1. Else `checkBot(config.TELEGRAM_BOT_TOKEN)` → ``log.info(`bot @${username} (id ${id})`)``, exit 0. Any error → ``log.error(`failed: ${telegramErrorLabel(error)}`)``, exit 1. The script needs no DB.
    - The bot user name and id are not secret; the token is.
  - Test (`check.test.ts`, unit; a fake Bot API with `Bun.serve({ port: 0 })` on 127.0.0.1, token marker `123456:MARKERTOKENaaaaaaaaaaaaaaaaaaaaaaaaaa`):
    - the fake answers `getMe` with `{ ok: true, result: { id: 7, is_bot: true, first_name: "b", username: "probe_bot", … } }` → `checkBot` returns `{ id: 7, username: "probe_bot" }`; the fake saw the path `/bot<token>/getMe`.
    - the fake answers `{ ok: false, error_code: 401, description: "Unauthorized" }` → `checkBot` rejects with `GrammyError`; `telegramErrorLabel` = `"GrammyError getMe 401"`.
    - `apiRoot` = a closed port (start a `Bun.serve`, read its port, `stop(true)`) → rejects with `HttpError`; the label is `"HttpError getMe"` and does not contain `MARKERTOKEN`.
    - `telegramErrorLabel(new Error("…MARKERTOKEN…"))` = `"Error"`; `telegramErrorLabel("x")` = `"string"`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`. Manual: `bun run telegram:check` on the Mac → `[telegram-check] bot @<dev bot user name> (id …)`.
  - Done when: the tests pass, and the manual run shows the dev bot user name that the user gave in step 0.1.
  - Out of scope: the error kinds for the sender (stage 5), polling (stage 15).
